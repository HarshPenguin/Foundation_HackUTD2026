<?php
// Exported claims to the fax gateway. Fax gateway decommissioned 2015. Not linked anywhere.
include("../config.php");
$r = mysql_query("SELECT * FROM claims");
while ($row = mysql_fetch_assoc($r)) { echo implode(",", $row) . "\n"; }
?>
