<?php

/**
 * JSON-RPC proxy for the static frontend in ui/.
 *
 * The browser talks to this file instead of Kanboard's jsonrpc.php. The API
 * token stays in the PHP session, so it never reaches the page: a stolen
 * localStorage or a screenshot cannot leak it.
 *
 * The call is executed in-process (no HTTP round trip to the server itself),
 * which also avoids deadlocks on single-worker PHP setups.
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

function kbui_rpc_error(int $status, int $code, string $message): void
{
    http_response_code($status);
    echo json_encode([
        'jsonrpc' => '2.0',
        'error' => ['code' => $code, 'message' => $message],
        'id' => null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (! SessionManager::isOpen()) {
    $container['sessionManager']->open();
}

// A cross-site page cannot reach this endpoint: a custom header and a JSON
// content type both force a CORS preflight, and we never answer one.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    kbui_rpc_error(405, 405, 'Method not allowed');
}

if (($_SERVER['HTTP_X_KBUI'] ?? '') !== '1') {
    kbui_rpc_error(403, 403, 'Missing client header');
}

if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
    kbui_rpc_error(415, 415, 'Expected application/json');
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 16 * 1024 * 1024) {
    kbui_rpc_error(413, 413, 'Request too large');
}

$userId = (int) ($_SESSION['kbui_uid'] ?? 0);
$token = (string) ($_SESSION['kbui_token'] ?? '');

if ($userId <= 0 || $token === '') {
    @file_put_contents(__DIR__ . '/_debug.log', date('H:i:s') . " 401 sid=" . session_id() .
        " keys=" . implode(',', array_keys($_SESSION)) . " cookies=" . json_encode(array_keys($_COOKIE)) . "\n", FILE_APPEND);
    kbui_rpc_error(401, 401, 'Not logged in');
}
@file_put_contents(__DIR__ . '/_debug.log', date('H:i:s') . " OK sid=" . session_id() . " uid=$userId\n", FILE_APPEND);

$user = $container['userModel']->getById($userId);

if (empty($user) || empty($user['is_active'])) {
    unset($_SESSION['kbui_uid'], $_SESSION['kbui_token']);
    kbui_rpc_error(401, 401, 'Not logged in');
}

// Close the session before doing any work: Kanboard's session handler does not
// lock rows, so a request that keeps the session open can write back a stale
// copy and wipe the login (many parallel API calls do exactly that).
session_write_close();

// Kanboard's JSON-RPC server reads PHP_AUTH_* and the body from php://input.
$_SERVER['PHP_AUTH_USER'] = $user['username'];
$_SERVER['PHP_AUTH_PW'] = $token;
$_SERVER['HTTP_AUTHORIZATION'] = 'Basic ' . base64_encode($user['username'] . ':' . $token);

// The server object copies $_SERVER when the container is built -- i.e. before
// we knew who is calling -- so register the provider once more to rebuild it
// with the credentials above. Same procedures, same permissions.
$container->register(new Kanboard\ServiceProvider\ApiProvider());

echo $container['api']->execute();
