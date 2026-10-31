<?php

/**
 * Login gate for the static frontend in ui/.
 *
 * Credentials are checked against Kanboard's own users table using Kanboard's
 * own AuthValidator, so the rules are identical to the classic login form:
 * inactive/LDAP/disabled-form users cannot log in, failed attempts are counted,
 * accounts lock after BRUTEFORCE_LOCKDOWN tries and a captcha kicks in after
 * BRUTEFORCE_CAPTCHA.
 *
 * On success the user's API token is kept in the PHP session and never sent to
 * the browser; ui/proxy.php uses it server-side to talk to Kanboard's JSON-RPC.
 *
 * Endpoints (all JSON):
 *   GET  login.php?action=status           -> {authenticated, user?}
 *   GET  login.php?action=captcha&username -> {needed, image?}
 *   POST login.php?action=login            -> {ok, user?} | {ok:false, error, captcha}
 *   POST login.php?action=logout           -> {ok:true}
 */

declare(strict_types=1);

require __DIR__ . '/../app/common.php';

// These endpoints speak JSON: a stray notice (e.g. the bundled captcha library
// emits PHP 8 deprecations) would corrupt the body. Log instead of print.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// SQLite has no write lock queue by default: concurrent requests make
// "database is locked" fatal (Kanboard's session handler writes rows too).
// Five seconds of waiting turns a hard failure into a slow request.
if (defined('DB_DRIVER') && DB_DRIVER === 'sqlite') {
    try {
        $container['db']->getConnection()->exec('PRAGMA busy_timeout = 5000');
    } catch (Throwable $e) {
        // tuning knob only -- never fail the request because of it
    }
}

use Kanboard\Core\Session\SessionManager;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function kbui_out(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function kbui_session($container): void
{
    if (! SessionManager::isOpen()) {
        $container['sessionManager']->open();
    }
}

function kbui_user($container): ?array
{
    $id = $_SESSION['kbui_uid'] ?? null;
    if (empty($id) || empty($_SESSION['kbui_token'])) {
        return null;
    }

    $user = $container['userModel']->getById((int) $id);
    if (empty($user) || empty($user['is_active'])) {
        unset($_SESSION['kbui_uid'], $_SESSION['kbui_token']);
        return null;
    }

    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'name' => empty($user['name']) ? $user['username'] : $user['name'],
        'role' => $user['role'],
    ];
}

function kbui_json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

kbui_session($container);

$action = isset($_GET['action']) ? (string) $_GET['action'] : 'status';

/* ------------------------------------------------------------------ status */
if ($action === 'status') {
    $user = kbui_user($container);
    kbui_out($user
        ? ['authenticated' => true, 'user' => $user]
        : ['authenticated' => false]);
}

/* ----------------------------------------------------------------- captcha */
if ($action === 'captcha') {
    $username = isset($_GET['username']) ? (string) $_GET['username'] : '';
    $needed = $username !== '' && $container['userLockingModel']->hasCaptcha($username);

    if (! $needed) {
        unset($_SESSION['captcha']);
        kbui_out(['needed' => false]);
    }

    $builder = new Gregwar\Captcha\CaptchaBuilder();
    $builder->build(200, 48);
    $_SESSION['captcha'] = $builder->getPhrase();

    kbui_out(['needed' => true, 'image' => $builder->inline()]);
}

/* ------------------------------------------------------------------- login */
if ($action === 'login') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        kbui_out(['ok' => false, 'error' => 'Koristi POST.'], 405);
    }

    $in = kbui_json_input();
    $username = trim((string) ($in['username'] ?? ''));
    $password = (string) ($in['password'] ?? '');
    $captcha = (string) ($in['captcha'] ?? '');

    if ($username === '' || $password === '') {
        kbui_out(['ok' => false, 'error' => 'Upiši korisničko ime i lozinku.']);
    }

    if ($container['userLockingModel']->isLocked($username)) {
        kbui_out([
            'ok' => false,
            'error' => 'Račun je zaključan na ' . BRUTEFORCE_LOCKDOWN_DURATION . ' minuta zbog previše pokušaja.',
            'captcha' => true,
        ]);
    }

    $values = ['username' => $username, 'password' => $password];
    if ($captcha !== '') {
        $values['captcha'] = $captcha;
    }

    list($valid, $errors) = $container['authValidator']->validateForm($values);

    if (! $valid) {
        $captchaNeeded = $container['userLockingModel']->hasCaptcha($username);

        if ($captchaNeeded && $captcha === '') {
            kbui_out([
                'ok' => false,
                'error' => 'Previše pokušaja — upiši znakove sa slike.',
                'captcha' => true,
            ]);
        }

        kbui_out([
            'ok' => false,
            'error' => 'Neispravno korisničko ime ili lozinka.',
            'captcha' => $captchaNeeded,
        ], 401);
    }

    $user = $container['userModel']->getByUsername($username);

    if (empty($user)) {
        kbui_out(['ok' => false, 'error' => 'Neispravno korisničko ime ili lozinka.'], 401);
    }

    if (! empty($user['twofactor_activated'])) {
        kbui_out([
            'ok' => false,
            'error' => 'Ovaj račun ima dvofaktorsku zaštitu. Prijavi se u Kanboard i koristi API token (Napredno).',
        ]);
    }

    // The token stays on the server. Generate one on first login, exactly like
    // Kanboard does in Profile -> API access.
    $token = (string) ($user['api_access_token'] ?? '');
    if ($token === '') {
        $token = bin2hex(random_bytes(20));
        $container['db']->table('users')->eq('id', $user['id'])->update(['api_access_token' => $token]);
    }

    $container['userLockingModel']->resetFailedLogin($username);
    $container['captchaModel']->resetFailedLogin($container['request']->getIpAddress());

    // delete_old_session=false: on Windows the old session file can still be
    // locked by the running request, and a failed destruction silently drops
    // everything written afterwards.
    session_regenerate_id();
    $_SESSION['kbui_uid'] = (int) $user['id'];
    $_SESSION['kbui_token'] = $token;
    unset($_SESSION['captcha']);
    session_write_close();

    kbui_out([
        'ok' => true,
        'user' => [
            'id' => (int) $user['id'],
            'username' => $user['username'],
            'name' => empty($user['name']) ? $user['username'] : $user['name'],
            'role' => $user['role'],
        ],
    ]);
}

/* ------------------------------------------------------------------ logout */
if ($action === 'logout') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        kbui_out(['ok' => false, 'error' => 'Koristi POST.'], 405);
    }

    unset($_SESSION['kbui_uid'], $_SESSION['kbui_token']);
    session_regenerate_id();
    session_write_close();

    kbui_out(['ok' => true]);
}

kbui_out(['ok' => false, 'error' => 'Nepoznata radnja.'], 404);
