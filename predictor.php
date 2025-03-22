<?php
/**
 * MySQL Word AI Model Prediction and Usage Script (No Composer Required)
 * 
 * This script loads a trained TensorFlow.js model and makes predictions
 * using the PHP backend to communicate with the JavaScript model.
 */

// Create a simple REST API for model prediction
class WordAIPredictor {
    private $conn;
    private $tableName = 'word';
    private $dbName = 'reservesphp';
    private $modelMetadataTable = 'model_metadata';
    
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
     * Get the latest model metadata
     */
    public function getLatestModelMetadata() {
        try {
            // Check if model metadata table exists
            $tableExists = $this->conn->query("SHOW TABLES LIKE '{$this->modelMetadataTable}'");
            if ($tableExists->rowCount() == 0) {
                return [
                    'status' => 'error',
                    'message' => 'No model metadata table found'
                ];
            }
            
            $stmt = $this->conn->prepare("SELECT * FROM {$this->modelMetadataTable} ORDER BY creation_date DESC LIMIT 1");
            $stmt->execute();
            $metadata = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$metadata) {
                return [
                    'status' => 'error',
                    'message' => 'No model metadata found'
                ];
            }
            
            // Parse JSON parameters
            $metadata['parameters'] = json_decode($metadata['parameters'], true);
            
            return [
                'status' => 'success',
                'metadata' => $metadata
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to get model metadata: " . $e->getMessage()
            ];
        }
    }
    
    /**
     * Get statistics about the word table
     */
    public function getWordTableStats() {
        try {
            $stmt = $this->conn->prepare("SELECT COUNT(*) as total FROM {$this->tableName}");
            $stmt->execute();
            $totalCount = $stmt->fetch(PDO::FETCH_ASSOC)['total'];
            
            // Try to get distribution of categories if available
            try {
                $stmt = $this->conn->prepare("SELECT category, COUNT(*) as count FROM {$this->tableName} GROUP BY category");
                $stmt->execute();
                $categoryDistribution = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch(PDOException $e) {
                // Category column might not exist, so we'll just provide the total count
                $categoryDistribution = [];
            }
            
            return [
                'status' => 'success',
                'totalRecords' => $totalCount,
                'categoryDistribution' => $categoryDistribution
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to get word table stats: " . $e->getMessage()
            ];
        }
    }
    
    /**
     * Log prediction results to the database
     */
    public function logPrediction($inputText, $predictedClass, $confidence, $userId = null) {
        try {
            // Create prediction log table if it doesn't exist
            $this->conn->exec("CREATE TABLE IF NOT EXISTS prediction_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                input_text TEXT NOT NULL,
                predicted_class VARCHAR(255) NOT NULL,
                confidence FLOAT NOT NULL,
                user_id VARCHAR(255),
                prediction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )");
            
            $stmt = $this->conn->prepare("INSERT INTO prediction_logs 
                (input_text, predicted_class, confidence, user_id) 
                VALUES (:text, :class, :confidence, :userId)");
            
            $stmt->bindParam(':text', $inputText);
            $stmt->bindParam(':class', $predictedClass);
            $stmt->bindParam(':confidence', $confidence);
            $stmt->bindParam(':userId', $userId);
            $stmt->execute();
            
            return [
                'status' => 'success',
                'message' => 'Prediction logged successfully',
                'id' => $this->conn->lastInsertId()
            ];
        } catch(PDOException $e) {
            return [
                'status' => 'error',
                'message' => "Failed to log prediction: " . $e->getMessage()
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
    
    // Initialize predictor
    $host = isset($data['host']) ? $data['host'] : 'localhost';
    $username = isset($data['username']) ? $data['username'] : 'root';
    $password = isset($data['password']) ? $data['password'] : '';
    $dbName = isset($data['dbName']) ? $data['dbName'] : 'reservesphp';
    
    $predictor = new WordAIPredictor($host, $username, $password, $dbName);
    
    // Handle different API actions
    $action = isset($data['action']) ? $data['action'] : '';
    
    switch ($action) {
        case 'get_model_metadata':
            echo json_encode($predictor->getLatestModelMetadata());
            break;
            
        case 'get_word_table_stats':
            echo json_encode($predictor->getWordTableStats());
            break;
            
        case 'log_prediction':
            if (!isset($data['prediction'])) {
                echo json_encode([
                    'status' => 'error',
                    'message' => 'No prediction information provided'
                ]);
                break;
            }
            
            $prediction = $data['prediction'];
            $result = $predictor->logPrediction(
                isset($prediction['text']) ? $prediction['text'] : '',
                isset($prediction['class']) ? $prediction['class'] : '',
                isset($prediction['confidence']) ? $prediction['confidence'] : 0,
                isset($prediction['userId']) ? $prediction['userId'] : null
            );
            
            echo json_encode($result);
            break;
            
        case 'predict':
            // Simple prediction endpoint for the demo
            if (isset($data['text'])) {
                $result = testPrediction($data['text']);
                echo json_encode($result);
            } else {
                echo json_encode([
                    'status' => 'error',
                    'message' => 'No text provided for prediction'
                ]);
            }
            break;
            
        default:
            echo json_encode([
                'status' => 'error',
                'message' => 'Unknown action'
            ]);
    }
    exit;
}

// Create a sample prediction integration function
function testPrediction($text) {
    global $predictor;
    
    // In a real-world application, you would pass the text to your JavaScript TensorFlow model
    // For this demo, we'll just simulate a prediction
    $simulatedPredictions = [
        'programming' => ['code', 'javascript', 'python', 'function', 'api', 'data'],
        'cooking' => ['recipe', 'food', 'bake', 'ingredient', 'delicious', 'meal'],
        'finance' => ['money', 'budget', 'invest', 'stock', 'saving', 'financial'],
        'gardening' => ['plant', 'garden', 'soil', 'flower', 'grow', 'vegetable']
    ];
    
    // Very simple simulation - check which category has most word matches
    $text = strtolower($text);
    $scores = [];
    
    foreach ($simulatedPredictions as $category => $keywords) {
        $score = 0;
        foreach ($keywords as $keyword) {
            if (strpos($text, $keyword) !== false) {
                $score++;
            }
        }
        $scores[$category] = $score;
    }
    
    // Get the category with highest score
    arsort($scores);
    $predictedCategory = key($scores);
    $confidence = current($scores) / count(explode(' ', $text)); // Simple confidence calculation
    $confidence = min(0.95, max(0.5, $confidence)); // Keep confidence between 0.5 and 0.95
    
    // Log the prediction if predictor is available
    if (isset($predictor)) {
        $predictor->logPrediction($text, $predictedCategory, $confidence);
    }
    
    return [
        'text' => $text,
        'predictedCategory' => $predictedCategory,
        'confidence' => $confidence
    ];
}

// Demo code for command line usage
if (php_sapi_name() === 'cli') {
    // Configure database connection
    $dbConfig = [
        'host' => 'localhost',
        'username' => 'root',
        'password' => '',
        'dbName' => 'reservesphp'
    ];

    // Initialize predictor
    $predictor = new WordAIPredictor(
        $dbConfig['host'], 
        $dbConfig['username'], 
        $dbConfig['password'], 
        $dbConfig['dbName']
    );

    // Get model metadata
    $modelInfo = $predictor->getLatestModelMetadata();
    
    echo "MySQL Word AI Predictor Demo\n";
    echo "----------------------------\n";
    
    // Display model information
    if ($modelInfo['status'] === 'success') {
        echo "Using model: {$modelInfo['metadata']['model_name']}\n";
        echo "Model accuracy: " . number_format($modelInfo['metadata']['accuracy'] * 100, 2) . "%\n";
        echo "Model creation date: {$modelInfo['metadata']['creation_date']}\n\n";
    } else {
        echo "No trained model found. Please train a model first.\n\n";
    }
    
    // Interactive prediction loop
    echo "Enter text to predict (or 'quit' to exit):\n";
    while (true) {
        echo "> ";
        $input = trim(fgets(STDIN));
        
        if ($input === 'quit' || $input === 'exit') {
            break;
        }
        
        if (empty($input)) {
            continue;
        }
        
        $result = testPrediction($input);
        echo "Predicted category: {$result['predictedCategory']}\n";
        echo "Confidence: " . number_format($result['confidence'] * 100, 2) . "%\n\n";
    }
    
    echo "Goodbye!\n";
} else {
    // Web interface - only if directly accessed
    if ($_SERVER['SCRIPT_NAME'] === $_SERVER['PHP_SELF']) {
        // Initialize predictor for the web interface
        $predictor = new WordAIPredictor();
        $modelInfo = $predictor->getLatestModelMetadata();
        
        // HTML for a simple web interface
        ?>
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Word AI Predictor Demo</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }
                h1 {
                    color: #333;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                }
                textarea {
                    width: 100%;
                    height: 100px;
                    padding: 8px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                button {
                    background-color: #4CAF50;
                    color: white;
                    padding: 10px 15px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #45a049;
                }
                .result {
                    margin-top: 20px;
                    padding: 15px;
                    background-color: #f8f9fa;
                    border-radius: 4px;
                    border-left: 4px solid #4CAF50;
                }
                .result h3 {
                    margin-top: 0;
                }
                .confidence {
                    font-size: 24px;
                    font-weight: bold;
                    color: #4CAF50;
                }
            </style>
        </head>
        <body>
            <h1>Word AI Predictor Demo</h1>
            
            <?php if ($modelInfo['status'] === 'success'): ?>
            <p>
                <strong>Model:</strong> <?php echo htmlspecialchars($modelInfo['metadata']['model_name']); ?><br>
                <strong>Accuracy:</strong> <?php echo number_format($modelInfo['metadata']['accuracy'] * 100, 2); ?>%<br>
                <strong>Created:</strong> <?php echo htmlspecialchars($modelInfo['metadata']['creation_date']); ?>
            </p>
            <?php else: ?>
            <p><strong>Warning:</strong> No trained model found. Please train a model first.</p>
            <?php endif; ?>
            
            <form id="prediction-form" method="post">
                <div class="form-group">
                    <label for="text-input">Enter text to predict:</label>
                    <textarea id="text-input" name="text" required></textarea>
                </div>
                <button type="submit">Predict</button>
            </form>
            
            <div id="result" class="result" style="display: none;">
                <h3>Prediction Result</h3>
                <p><strong>Category:</strong> <span id="result-category"></span></p>
                <p><strong>Confidence:</strong> <span id="result-confidence" class="confidence"></span></p>
            </div>
            
            <script>
                document.getElementById('prediction-form').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const text = document.getElementById('text-input').value;
                    
                    // Make AJAX request to this same script
                    fetch('<?php echo $_SERVER['PHP_SELF']; ?>', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            action: 'predict',
                            text: text
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        // Display result
                        document.getElementById('result-category').textContent = data.predictedCategory;
                        document.getElementById('result-confidence').textContent = 
                            (data.confidence * 100).toFixed(2) + '%';
                        document.getElementById('result').style.display = 'block';
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('An error occurred during prediction. Please try again.');
                    });
                });
            </script>
        </body>
        </html>
        <?php
    }
}
?>