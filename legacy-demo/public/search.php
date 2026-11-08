<?php
include("../config.php");
include("../lib/totals.php");

$name = $_GET['name'];
$sql = "SELECT id, patient_name, dob, status, submitted_on FROM claims WHERE patient_name LIKE '%" . $name . "%' ORDER BY submitted_on DESC";
$result = mysql_query($sql) or die(mysql_error());
?>
<table class="claims">
<tr><th>ID</th><th>Patient</th><th>DOB</th><th>Status</th><th>Submitted</th></tr>
<?php while ($row = mysql_fetch_assoc($result)) { ?>
<tr class="claim-row" data-id="<?php echo $row['id']; ?>">
  <td><?php echo $row['id']; ?></td>
  <td><?php echo $row['patient_name']; ?></td>
  <td><?php echo $row['dob']; ?></td>
  <td><?php echo $row['status']; ?></td>
  <td><?php echo $row['submitted_on']; ?></td>
</tr>
<?php } ?>
</table>
