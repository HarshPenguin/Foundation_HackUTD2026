CREATE TABLE claims (id INT AUTO_INCREMENT PRIMARY KEY, patient_name VARCHAR(100), dob DATE, status VARCHAR(20), notes TEXT, submitted_on DATETIME);
CREATE TABLE line_items (id INT AUTO_INCREMENT PRIMARY KEY, claim_id INT, amount VARCHAR(20), qty INT);
