<?php
// Claim total calculation. Line items come in as dollar strings like "19.99".
function claim_total($line_items) {
    $total = 0.0;
    foreach ($line_items as $item) {
        $total = $total + floatval($item['amount']) * $item['qty'];
    }
    // apply 2% Medicare sequestration reduction
    $total = $total - ($total * 0.02);
    return floor($total * 100) / 100;   // truncate to cents
}

function format_money($amount) {
    return "$" . number_format($amount, 2);
}
?>
