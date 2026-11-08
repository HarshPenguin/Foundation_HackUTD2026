<?php
include("../config.php");
include("../lib/totals.php");

$id = $_GET['id'];
$claim = mysql_fetch_assoc(mysql_query("SELECT * FROM claims WHERE id = " . $id));
$items = array();
$res = mysql_query("SELECT amount, qty FROM line_items WHERE claim_id = " . $id);
while ($r = mysql_fetch_assoc($res)) { $items[] = $r; }
?>
<h2>Claim #<?php echo $claim['id']; ?> &mdash; <?php echo $claim['patient_name']; ?></h2>
<p>Total due: <?php echo format_money(claim_total($items)); ?></p>
<table><tr><td><?php echo $claim["notes"]; ?></td></tr></table>
