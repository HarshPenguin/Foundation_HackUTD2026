// MOCK: the Developer's "offline playbook". When the model is simulated or unreachable (or its patch fails
// php -l), the Developer applies these known-good fixes for the planted MediClaim bugs.
// Real: the same request goes to the provider; its full-file reply is used when it passes the checks.
import type { FixKey } from '@foundation/shared';

const SEARCH_PHP = `<?php
include("../config.php");
include("../lib/totals.php");

// Search with a prepared statement: the patient name is sent as data, never as SQL.
$name = isset($_GET['name']) ? (string) $_GET['name'] : '';
$pdo = new PDO(
    "mysql:host=" . $DB_HOST . ";dbname=" . $DB_NAME . ";charset=utf8mb4",
    $DB_USER,
    $DB_PASS,
    array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION)
);
$stmt = $pdo->prepare("SELECT id, patient_name, dob, status, submitted_on FROM claims WHERE patient_name LIKE :name ORDER BY submitted_on DESC");
$stmt->execute(array(':name' => '%' . $name . '%'));

function h($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}
?>
<table class="claims">
<tr><th>ID</th><th>Patient</th><th>DOB</th><th>Status</th><th>Submitted</th></tr>
<?php while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { ?>
<tr class="claim-row" data-id="<?php echo h($row['id']); ?>">
  <td><?php echo h($row['id']); ?></td>
  <td><?php echo h($row['patient_name']); ?></td>
  <td><?php echo h($row['dob']); ?></td>
  <td><?php echo h($row['status']); ?></td>
  <td><?php echo h($row['submitted_on']); ?></td>
</tr>
<?php } ?>
</table>
`;

const TOTALS_PHP = `<?php
// Claim total calculation. Line items come in as dollar strings like "19.99".
// Money is handled as whole cents (integers) so totals never drift.

// "19.99" -> 1999. Extra decimals round half up to the cent.
function to_cents($amount) {
    $s = trim((string) $amount);
    $negative = false;
    if ($s !== '' && $s[0] === '-') { $negative = true; $s = substr($s, 1); }
    $parts = explode('.', $s, 2);
    $dollars = ($parts[0] === '') ? 0 : intval($parts[0]);
    $fraction = isset($parts[1]) ? preg_replace('/[^0-9]/', '', $parts[1]) : '';
    $cents = $dollars * 100 + intval(substr(str_pad($fraction, 2, '0'), 0, 2));
    if (strlen($fraction) > 2 && intval($fraction[2]) >= 5) { $cents += 1; }
    return $negative ? -$cents : $cents;
}

// Returns the claim total in whole cents.
function claim_total($line_items) {
    $total = 0;
    foreach ($line_items as $item) {
        $total += to_cents($item['amount']) * intval($item['qty']);
    }
    // apply 2% Medicare sequestration reduction, rounded half up to the cent
    $reduction = intdiv($total * 2 + 50, 100);
    return $total - $reduction;
}

// Formats whole cents as dollars, e.g. 5965 -> "$59.65".
function format_money($cents) {
    $cents = intval($cents);
    $sign = $cents < 0 ? "-" : "";
    $cents = abs($cents);
    return $sign . "$" . number_format(intdiv($cents, 100)) . "." . str_pad((string) ($cents % 100), 2, "0", STR_PAD_LEFT);
}
?>
`;

const CONFIG_PHP = `<?php
// MediClaim configuration
$DB_HOST = getenv("MEDICLAIM_DB_HOST") ?: "localhost";
$DB_USER = getenv("MEDICLAIM_DB_USER") ?: "mediclaim";
$DB_PASS = getenv("MEDICLAIM_DB_PASS");   // set in the server environment, never in code
$DB_NAME = getenv("MEDICLAIM_DB_NAME") ?: "mediclaim_prod";

if ($DB_PASS === false || $DB_PASS === "") {
    die("DB error: MEDICLAIM_DB_PASS is not set");
}

$link = mysql_connect($DB_HOST, $DB_USER, $DB_PASS) or die("DB error: " . mysql_error());
mysql_select_db($DB_NAME, $link);
?>
`;

const INDEX_PHP = `<?php include("../config.php"); ?>
<html>
<head>
  <title>MediClaim - Claims Intake</title>
  <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
  <script>
  $(function() {
    $("#search-form").on("submit", function(e) {
      e.preventDefault();
      $.get("search.php", { name: $("#name").val() }, function(html) { $("#results").html(html); });
    });
    $(document).on("click", ".claim-row", function() { window.location = "claim.php?id=" + encodeURIComponent($(this).attr("data-id")); });
  });
  </script>
</head>
<body>
  <h1>MediClaim</h1>
  <form id="search-form"><input id="name" name="name" placeholder="Patient name"> <input type="submit" value="Search"></form>
  <div id="results"></div>
</body>
</html>
`;

export const CANNED_FIXES: Record<FixKey, string> = {
  sqli: SEARCH_PHP,
  rounding: TOTALS_PHP,
  config_secret: CONFIG_PHP,
  jquery: INDEX_PHP,
};

export const FIX_SUMMARIES: Record<FixKey, string> = {
  sqli: 'Claim search now uses a PDO prepared statement with a bound :name parameter, and every value printed is escaped',
  rounding: 'Claim totals are now added in whole cents, and the 2% reduction rounds half up to the cent',
  config_secret: 'The database password is now read from the MEDICLAIM_DB_PASS environment variable',
  jquery: 'The page now loads jQuery 3.7.1 and uses .on() instead of the removed .live() and $.browser',
};
