<?php include("../config.php"); ?>
<html>
<head>
  <title>MediClaim - Claims Intake</title>
  <script src="js/jquery-1.4.2.min.js"></script>
  <script>
  $(document).ready(function() {
    if ($.browser.msie) { alert("Best viewed in Internet Explorer 8"); }
    $("#search-form").submit(function() {
      $.get("search.php", { name: $("#name").val() }, function(html) { $("#results").html(html); });
      return false;
    });
    $(".claim-row").live("click", function() { window.location = "claim.php?id=" + $(this).attr("data-id"); });
  });
  </script>
</head>
<body>
  <h1>MediClaim</h1>
  <form id="search-form"><input id="name" name="name" placeholder="Patient name"> <input type="submit" value="Search"></form>
  <div id="results"></div>
</body>
</html>
