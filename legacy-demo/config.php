<?php
// MediClaim configuration (2012)
$DB_HOST = "localhost";
$DB_USER = "mediclaim";
$DB_PASS = "Medic@re2012!";   // TODO move this somewhere safer
$DB_NAME = "mediclaim_prod";

$link = mysql_connect($DB_HOST, $DB_USER, $DB_PASS) or die("DB error: " . mysql_error());
mysql_select_db($DB_NAME, $link);
?>
