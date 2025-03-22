<?php
/**
 * MySQL Word Database AI Trainer
 * 
 * This script connects to a MySQL database, fetches data from the 'word' table,
 * and provides an API for a JavaScript TensorFlow model to use the data for training.
 * No Composer or external dependencies required.
 */

class WordDatabaseAITrainer {
    private $conn;
    private $tableName = 'word';
    private $dbName = 'reservesphp';
    
    /**
     * Constructor - initialize database connection
     */
    public function __construct($host = 'localhost', $username = 'root', $password = '', $dbName = 'reservesphp') {
        $this->dbName = $dbName;
        try {
            $this->conn = new PDO("mysql:host=$host;dbname=$dbName", $username, $password);
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        } catch(PDOException $e) {
            die("Connection failed: " . $e->getMessage());
        }
    }
    
    /**
     * Get table schema information
     */
    public function getTableSchema() {
        try {
            $stmt = $this->conn->prepare("DESCRIBE {$this->tableName}");
            $stmt->execute();
            $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            return [
                'status' => 'success',
                'schema' => $columns
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to get schema: " . $e->getMessage()
            ];
        }
    }
    
    /**
     * Get total count of records
     */
    public function getTotalRecords() {
        try {
            $stmt = $this->conn->prepare("SELECT COUNT(*) as total FROM {$this->tableName}");
            $stmt->execute();
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            
            return [
                'status' => 'success',
                'count' => $result['total']
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to get count: " . $e->getMessage()
            ];
        }
    }
    
    /**
     * Get data in batches for training
     */
    public function getTrainingBatch($offset = 0, $limit = 100) {
        try {
            $stmt = $this->conn->prepare("SELECT * FROM {$this->tableName} LIMIT :offset, :limit");
            $stmt->bindParam(':offset', $offset, PDO::PARAM_INT);
            $stmt->bindParam(':limit', $limit, PDO::PARAM_INT);
            $stmt->execute();
            $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            return [
                'status' => 'success',
                'data' => $data,
                'offset' => $offset,
                'limit' => $limit,
                'count' => count($data)
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to fetch data: " . $e->getMessage()
            ];
        }
    }
    
    /**
     * Save trained model metadata to database
     */
    public function saveModelMetadata($modelInfo) {
        try {
            // Create a new table for model metadata if it doesn't exist
            $this->conn->exec("CREATE TABLE IF NOT EXISTS model_metadata (
                id INT AUTO_INCREMENT PRIMARY KEY,
                model_name VARCHAR(255) NOT NULL,
                accuracy FLOAT,
                parameters TEXT,
                creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                model_path VARCHAR(255)
            )");
            
            $stmt = $this->conn->prepare("INSERT INTO model_metadata 
                (model_name, accuracy, parameters, model_path) 
                VALUES (:name, :accuracy, :parameters, :path)");
            
            $stmt->bindParam(':name', $modelInfo['name']);
            $stmt->bindParam(':accuracy', $modelInfo['accuracy']);
            $stmt->bindParam(':parameters', json_encode($modelInfo['parameters']));
            $stmt->bindParam(':path', $modelInfo['path']);
            $stmt->execute();
            
            return [
                'status' => 'success',
                'message' => 'Model metadata saved successfully',
                'id' => $this->conn->lastInsertId()
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to save model metadata: " . $e->getMessage()
            ];
        }
    }
}

// API endpoint handling
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    
    // Get JSON data from request
    $jsonData = file_get_contents('php://input');
    $data = json_decode($jsonData, true);
    
    // If json_decode fails, try to handle form data
    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        $data = $_POST;
    }
    
    // Initialize trainer
    $host = isset($data['host']) ? $data['host'] : 'localhost';
    $username = isset($data['username']) ? $data['username'] : 'root';
    $password = isset($data['password']) ? $data['password'] : '';
    $dbName = isset($data['dbName']) ? $data['dbName'] : 'reservesphp';
    
    $trainer = new WordDatabaseAITrainer($host, $username, $password, $dbName);
    
    // Handle different API actions
    $action = isset($data['action']) ? $data['action'] : '';
    
    switch ($action) {
        case 'get_schema':
            echo json_encode($trainer->getTableSchema());
            break;
            
        case 'get_count':
            echo json_encode($trainer->getTotalRecords());
            break;
            
        case 'get_batch':
            $offset = isset($data['offset']) ? (int)$data['offset'] : 0;
            $limit = isset($data['limit']) ? (int)$data['limit'] : 100;
            echo json_encode($trainer->getTrainingBatch($offset, $limit));
            break;
            
        case 'save_model':
            if (!isset($data['model'])) {
                echo json_encode([
                    'status' => 'error',
                    'message' => 'No model information provided'
                ]);
                break;
            }
            echo json_encode($trainer->saveModelMetadata($data['model']));
            break;
            
        default:
            echo json_encode([
                'status' => 'error',
                'message' => 'Unknown action'
            ]);
    }
} else {
    // For direct script access
    if (php_sapi_name() === 'cli') {
        $trainer = new WordDatabaseAITrainer();
        print_r($trainer->getTableSchema());
        print_r($trainer->getTotalRecords());
        print_r($trainer->getTrainingBatch(0, 5));
    } else {
        // For browser access without POST
        header('Content-Type: application/json');
        echo json_encode([
            'status' => 'error',
            'message' => 'This endpoint requires a POST request'
        ]);
    }
}
?>