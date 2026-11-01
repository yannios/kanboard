<?php

/**
 * Create or update a user, with readable validation errors.
 *
 * Kanboard's JSON-RPC createUser() only answers true/false, so the UI could not
 * tell a short password from a taken username. This endpoint runs Kanboard's own
 * UserValidator and returns its messages per field.
 *
 * POST user.php?action=save
 *   { id?, username, password?, name, email, role }
 */

declare(strict_types=1);

require __DIR__ . '/../app/common.php';

use Kanboard\Core\Session\SessionManager;

ini_set('display_errors', '0');
ini_set('log_errors', '1');

if (defined('DB_DRIVER') && DB_DRIVER === 'sqlite') {
    try {
        $container['db']->getConnection()->exec('PRAGMA busy_timeout = 5000');
    } catch (Throwable $e) {
    }
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Kanboard vraća poruke na jeziku aplikacije; ovdje su najčešće na hrvatskom.
function kbui_translate(string $msg): string
{
    $map = [
        'This username is already taken' => 'To korisničko ime već postoji.',
        'The username is required' => 'Korisničko ime je obavezno.',
        'The password is required' => 'Lozinka je obavezna.',
        'The confirmation is required' => 'Potvrda lozinke je obavezna.',
        "Passwords don't match" => 'Lozinke se ne podudaraju.',
        'Email address invalid' => 'E-mail adresa nije ispravna.',
        'This role is invalid' => 'Rola nije ispravna.',
    ];

    foreach ($map as $en => $hr) {
        if (stripos($msg, $en) !== false) {
            return $hr;
        }
    }

    if (preg_match('/The minimum length is (\d+) characters/i', $msg, $m)) {
        return 'Mora imati barem ' . $m[1] . ' znakova.';
    }

    return $msg;
}

function kbui_json(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if (! SessionManager::isOpen()) {
    $container['sessionManager']->open();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    kbui_json(['ok' => false, 'errors' => ['_form' => 'Koristi POST.']], 405);
}

$uid = (int) ($_SESSION['kbui_uid'] ?? 0);
$me = $uid > 0 ? $container['userModel']->getById($uid) : null;

if (empty($me) || $me['role'] !== 'app-admin') {
    kbui_json(['ok' => false, 'errors' => ['_form' => 'Samo administrator može uređivati korisnike.']], 403);
}

$in = json_decode((string) file_get_contents('php://input'), true) ?: [];

$id = isset($in['id']) ? (int) $in['id'] : 0;
$username = trim((string) ($in['username'] ?? ''));
$password = (string) ($in['password'] ?? '');
$name = trim((string) ($in['name'] ?? ''));
$email = trim((string) ($in['email'] ?? ''));
$role = (string) ($in['role'] ?? 'app-user');

$values = [
    'username' => $username,
    'name' => $name,
    'email' => $email,
    'role' => $role,
];

if ($id > 0) {
    if ($id === $uid && $role !== 'app-admin') {
        kbui_json(['ok' => false, 'errors' => ['role' => 'Ne možeš sebi ukinuti administratorsku rolu.']]);
    }

    $values['id'] = $id;
    list($valid, $errors) = $container['userValidator']->validateModification($values);

    if (! $valid) {
        kbui_json(['ok' => false, 'errors' => $errors]);
    }

    $ok = $container['userModel']->update($values);
    kbui_json($ok
        ? ['ok' => true]
        : ['ok' => false, 'errors' => ['_form' => 'Kanboard nije spremio izmjene.']]);
}

// creation: mirror the API payload
$values['password'] = $password;
$values['confirmation'] = $password;

list($valid, $errors) = $container['userValidator']->validateCreation($values);

if (! $valid) {
    $map = [];
    foreach ($errors as $field => $msgs) {
        $map[$field] = kbui_translate(is_array($msgs) ? implode(' ', $msgs) : (string) $msgs);
    }
    kbui_json(['ok' => false, 'errors' => $map]);
}

$newId = $container['userModel']->create($values);

kbui_json($newId
    ? ['ok' => true, 'id' => (int) $newId]
    : ['ok' => false, 'errors' => ['_form' => 'Kanboard nije stvorio korisnika.']]);
