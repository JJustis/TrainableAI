/**
 * MySQL Word Database TensorFlow AI Trainer
 * 
 * This JavaScript application fetches data from a PHP backend connected to a MySQL database,
 * and trains a TensorFlow.js model on the word data.
 */

// Configuration
const config = {
  apiEndpoint: 'api.php',  // Path to the PHP backend
  batchSize: 32,           // Batch size for training
  epochs: 50,              // Number of training epochs
  validationSplit: 0.2,    // Portion of data to use for validation
  modelSavePath: 'model/', // Path where to save the trained model
  dbConfig: {
    host: 'localhost',
    username: 'root',
    password: '',
    dbName: 'reservesphp'
  }
};

// Main WordAI class
class WordAI {
  constructor() {
    this.model = null;
    this.features = [];
    this.labels = [];
    this.labelMap = {};
    this.featureColumns = [];
    this.labelColumn = null;
    this.preprocessors = {};
    this.schema = null;
    this.totalRecords = 0;
    this.dataLoaded = false;
    this.trainingLogs = [];
    
    // UI elements
    this.logElement = document.getElementById('training-log');
    this.progressElement = document.getElementById('training-progress');
    this.statusElement = document.getElementById('status');
  }
  
  /**
   * Initialize the application
   */
  async init() {
    this.updateStatus('Initializing...');
    
    try {
      // Get the database schema to understand our data
      await this.fetchSchema();
      
      // Get total record count
      await this.fetchTotalRecords();
      
      // Load initial batch of data
      await this.loadData();
      
      // Initialize TensorFlow model
      this.initModel();
      
      this.updateStatus('Ready to train');
      document.getElementById('train-button').disabled = false;
    } catch (error) {
      this.updateStatus(`Error during initialization: ${error.message}`, true);
      console.error(error);
    }
  }
  
  /**
   * Fetch database schema to understand the structure of the word table
   */
  async fetchSchema() {
    const response = await this.apiRequest('get_schema');
    
    if (response.status === 'success') {
      this.schema = response.schema;
      this.logMessage(`Schema loaded with ${this.schema.length} columns`);
      
      // Automatically determine feature columns and label column
      // We'll use all columns except 'id' as features for now
      this.schema.forEach(column => {
        if (column.Field === 'id') {
          // Skip ID field
          return;
        } else if (column.Key === 'PRI' || column.Field === 'category' || column.Field === 'label') {
          // Use any Primary Key or columns named 'category' or 'label' as the label
          this.labelColumn = column.Field;
        } else {
          // Use all other columns as features
          this.featureColumns.push(column.Field);
        }
      });
      
      // If no label column was identified, use the first non-id column
      if (!this.labelColumn && this.schema.length > 1) {
        for (let i = 0; i < this.schema.length; i++) {
          if (this.schema[i].Field !== 'id') {
            this.labelColumn = this.schema[i].Field;
            // Remove this from feature columns if it was added
            const index = this.featureColumns.indexOf(this.labelColumn);
            if (index > -1) {
              this.featureColumns.splice(index, 1);
            }
            break;
          }
        }
      }
      
      this.logMessage(`Selected features: ${this.featureColumns.join(', ')}`);
      this.logMessage(`Selected label: ${this.labelColumn}`);
    } else {
      throw new Error(`Failed to fetch schema: ${response.message}`);
    }
  }
  
  /**
   * Get total record count from database
   */
  async fetchTotalRecords() {
    const response = await this.apiRequest('get_count');
    
    if (response.status === 'success') {
      this.totalRecords = response.count;
      this.logMessage(`Total records in database: ${this.totalRecords}`);
    } else {
      throw new Error(`Failed to fetch record count: ${response.message}`);
    }
  }
  
  /**
   * Load data from database for training
   */
  async loadData(offset = 0, limit = 1000) {
    this.updateStatus(`Loading data (${offset}/${this.totalRecords})...`);
    
    // Calculate how many batches we'll need to load all data
    const batchesToLoad = Math.ceil(this.totalRecords / limit);
    let currentBatch = Math.floor(offset / limit) + 1;
    
    const response = await this.apiRequest('get_batch', { offset, limit });
    
    if (response.status === 'success') {
      this.processDataBatch(response.data);
      
      if (response.count === limit && offset + limit < this.totalRecords) {
        // Update progress
        const progress = Math.min(100, Math.round((currentBatch / batchesToLoad) * 100));
        this.updateProgress(progress);
        
        // Load next batch
        await this.loadData(offset + limit, limit);
      } else {
        // All data loaded
        this.dataLoaded = true;
        this.updateStatus(`Data loading complete. ${this.features.length} records processed.`);
        this.updateProgress(100);
        
        // Create vocabulary for text features
        await this.createVocabularies();
      }
    } else {
      throw new Error(`Failed to fetch data batch: ${response.message}`);
    }
  }
  
  /**
   * Process a batch of data from the database
   */
  processDataBatch(data) {
    // Process each row and extract features and labels
    data.forEach(row => {
      // Extract features from the row
      const featureValues = {};
      
      this.featureColumns.forEach(column => {
        // Skip null values
        if (row[column] !== null) {
          featureValues[column] = row[column];
        }
      });
      
      // Extract label
      if (row[this.labelColumn] !== null) {
        // Track unique labels for one-hot encoding
        if (!this.labelMap[row[this.labelColumn]]) {
          this.labelMap[row[this.labelColumn]] = Object.keys(this.labelMap).length;
        }
        
        // Add to our dataset
        this.features.push(featureValues);
        this.labels.push(this.labelMap[row[this.labelColumn]]);
      }
    });
    
    this.logMessage(`Processed batch with ${data.length} records. Total processed: ${this.features.length}`);
  }
  
  /**
   * Create vocabularies for text features
   */
  async createVocabularies() {
    this.updateStatus('Creating vocabularies for text features...');
    
    // For each text feature, create a vocabulary
    for (const column of this.featureColumns) {
      // Get all unique values for this column
      const allValues = this.features.map(f => f[column] || '').filter(v => v !== '');
      
      // For text columns, create a word-level vocabulary
      // Here we use a simple space-based tokenization
      let allWords = new Set();
      
      allValues.forEach(text => {
        if (typeof text === 'string') {
          const words = text.toLowerCase().split(/\s+/);
          words.forEach(word => {
            if (word) allWords.add(word);
          });
        }
      });
      
      // Create a mapping from word to index
      const vocabulary = {};
      Array.from(allWords).forEach((word, index) => {
        vocabulary[word] = index + 1; // Reserve 0 for unknown words
      });
      
      this.preprocessors[column] = {
        type: 'text',
        vocabulary: vocabulary,
        vocabSize: Object.keys(vocabulary).length + 1 // +1 for unknown token
      };
      
      this.logMessage(`Created vocabulary for column '${column}' with ${Object.keys(vocabulary).length} unique words`);
    }
    
    // Create label mapping
    this.logMessage(`Created label mapping with ${Object.keys(this.labelMap).length} unique classes`);
  }
  
  /**
   * Initialize TensorFlow model architecture
   */
  initModel() {
    this.updateStatus('Initializing TensorFlow model...');
    
    // Determine input shape based on features
    const inputLayers = {};
    const embeddingLayers = [];
    
    // Create embedding layers for each text feature
    for (const column of this.featureColumns) {
      const preprocessor = this.preprocessors[column];
      
      if (preprocessor.type === 'text') {
        // Create an input layer for this feature
        const inputLayer = tf.input({
          name: column,
          shape: [null], // Variable length sequences
          dtype: 'int32'
        });
        
        inputLayers[column] = inputLayer;
        
        // Create an embedding layer for this feature
        const embeddingSize = Math.min(50, Math.ceil(Math.sqrt(preprocessor.vocabSize)));
        const embedding = tf.layers.embedding({
          inputDim: preprocessor.vocabSize,
          outputDim: embeddingSize,
          maskZero: true,
          name: `${column}_embedding`
        }).apply(inputLayer);
        
        // Global pooling to handle variable sequence lengths
        const pooled = tf.layers.globalAveragePooling1d({
          name: `${column}_pooling`
        }).apply(embedding);
        
        embeddingLayers.push(pooled);
      }
    }
    
    // Combine all feature embeddings
    let combined;
    if (embeddingLayers.length > 1) {
      combined = tf.layers.concatenate({
        name: 'combined_features'
      }).apply(embeddingLayers);
    } else if (embeddingLayers.length === 1) {
      combined = embeddingLayers[0];
    } else {
      throw new Error('No usable feature columns found for modeling');
    }
    
    // Add dense layers
    const hidden1 = tf.layers.dense({
      units: 64,
      activation: 'relu',
      name: 'hidden1'
    }).apply(combined);
    
    const dropout = tf.layers.dropout({
      rate: 0.2,
      name: 'dropout'
    }).apply(hidden1);
    
    const hidden2 = tf.layers.dense({
      units: 32,
      activation: 'relu',
      name: 'hidden2'
    }).apply(dropout);
    
    // Output layer
    const numClasses = Object.keys(this.labelMap).length;
    const output = tf.layers.dense({
      units: numClasses,
      activation: 'softmax',
      name: 'output'
    }).apply(hidden2);
    
    // Create and compile the model
    this.model = tf.model({
      inputs: Object.values(inputLayers),
      outputs: output
    });
    
    this.model.compile({
      optimizer: 'adam',
      loss: 'sparseCategoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    // Log model summary
    this.logMessage('Model initialized with architecture:');
    const layers = this.model.layers;
    for (let i = 0; i < layers.length; i++) {
      this.logMessage(`- ${layers[i].name}: ${JSON.stringify(layers[i].outputShape)}`);
    }
  }
  
  /**
   * Prepare training data in TensorFlow format
   */
  prepareTrainingData() {
    this.updateStatus('Preparing training data...');
    
    // For each feature, prepare the corresponding tensor
    const inputTensors = {};
    
    for (const column of this.featureColumns) {
      const preprocessor = this.preprocessors[column];
      
      if (preprocessor.type === 'text') {
        // Convert text to token sequences
        const sequences = this.features.map(f => {
          const text = f[column] || '';
          if (typeof text !== 'string') return [0]; // Handle non-string values
          
          // Tokenize and convert to indices
          return text.toLowerCase().split(/\s+/).map(word => {
            return preprocessor.vocabulary[word] || 0; // 0 for unknown words
          });
        });
        
        // Pad sequences to same length
        const maxLength = Math.max(...sequences.map(s => s.length));
        const paddedSequences = sequences.map(seq => {
          if (seq.length >= maxLength) return seq.slice(0, maxLength);
          return [...seq, ...Array(maxLength - seq.length).fill(0)];
        });
        
        // Create tensor
        inputTensors[column] = tf.tensor2d(paddedSequences, [paddedSequences.length, maxLength], 'int32');
      }
    }
    
    // Create labels tensor
    const labelsTensor = tf.tensor1d(this.labels, 'int32');
    
    return {
      xs: inputTensors,
      ys: labelsTensor
    };
  }
  
  /**
   * Start model training process
   */
  async trainModel() {
    try {
      this.updateStatus('Starting training...');
      document.getElementById('train-button').disabled = true;
      
      // Prepare data
      const trainingData = this.prepareTrainingData();
      
      // Set up training callbacks
      const callbacks = {
        onEpochEnd: (epoch, logs) => {
          const progress = Math.round(((epoch + 1) / config.epochs) * 100);
          this.updateProgress(progress);
          
          const logMessage = `Epoch ${epoch + 1}/${config.epochs} - loss: ${logs.loss.toFixed(4)} - accuracy: ${logs.acc.toFixed(4)}`;
          if (logs.val_loss) {
            logMessage += ` - val_loss: ${logs.val_loss.toFixed(4)} - val_acc: ${logs.val_acc.toFixed(4)}`;
          }
          
          this.logMessage(logMessage);
          this.trainingLogs.push(logs);
        },
        onTrainEnd: () => {
          this.updateStatus('Training complete!');
          document.getElementById('evaluate-button').disabled = false;
          document.getElementById('save-button').disabled = false;
        }
      };
      
      // Train the model
      await this.model.fit(trainingData.xs, trainingData.ys, {
        epochs: config.epochs,
        batchSize: config.batchSize,
        validationSplit: config.validationSplit,
        callbacks: callbacks
      });
      
      // Clean up tensors
      Object.values(trainingData.xs).forEach(tensor => tensor.dispose());
      trainingData.ys.dispose();
      
      this.updateStatus('Training complete! You can now evaluate or save the model.');
    } catch (error) {
      this.updateStatus(`Error during training: ${error.message}`, true);
      console.error(error);
      document.getElementById('train-button').disabled = false;
    }
  }
  
  /**
   * Evaluate the trained model
   */
  async evaluateModel() {
    try {
      this.updateStatus('Evaluating model...');
      
      // Prepare evaluation data
      const evalData = this.prepareTrainingData();
      
      // Evaluate the model
      const result = await this.model.evaluate(evalData.xs, evalData.ys);
      
      // Get loss and accuracy
      const loss = result[0].dataSync()[0];
      const accuracy = result[1].dataSync()[0];
      
      this.logMessage(`Evaluation results - Loss: ${loss.toFixed(4)}, Accuracy: ${accuracy.toFixed(4)}`);
      this.updateStatus(`Evaluation complete - Loss: ${loss.toFixed(4)}, Accuracy: ${accuracy.toFixed(4)}`);
      
      // Clean up tensors
      result.forEach(tensor => tensor.dispose());
      Object.values(evalData.xs).forEach(tensor => tensor.dispose());
      evalData.ys.dispose();
      
      return { loss, accuracy };
    } catch (error) {
      this.updateStatus(`Error during evaluation: ${error.message}`, true);
      console.error(error);
    }
  }
  
  /**
   * Save the trained model
   */
  async saveModel() {
    try {
      this.updateStatus('Saving model...');
      
      // Save model using TensorFlow.js
      await this.model.save(`localstorage://word-ai-model`);
      
      // Generate inverse label map for predictions
      const inverseLabelMap = {};
      Object.entries(this.labelMap).forEach(([label, index]) => {
        inverseLabelMap[index] = label;
      });
      
      // Save preprocessors and label mapping to localStorage
      localStorage.setItem('word-ai-preprocessors', JSON.stringify(this.preprocessors));
      localStorage.setItem('word-ai-labelmap', JSON.stringify(inverseLabelMap));
      
      // Save model metadata to database
      const evalResults = await this.evaluateModel();
      
      const modelInfo = {
        name: 'word-ai-model',
        accuracy: evalResults.accuracy,
        parameters: {
          featureColumns: this.featureColumns,
          labelColumn: this.labelColumn,
          numClasses: Object.keys(this.labelMap).length,
          epochs: config.epochs,
          batchSize: config.batchSize
        },
        path: 'localstorage://word-ai-model'
      };
      
      const response = await this.apiRequest('save_model', { model: modelInfo });
      
      if (response.status === 'success') {
        this.logMessage(`Model saved successfully with ID: ${response.id}`);
        this.updateStatus('Model saved successfully!');
      } else {
        this.logMessage(`Warning: Model saved to browser but failed to save metadata to database: ${response.message}`);
        this.updateStatus('Model saved to browser but failed to save metadata to database.');
      }
    } catch (error) {
      this.updateStatus(`Error saving model: ${error.message}`, true);
      console.error(error);
    }
  }
  
  /**
   * Make a prediction with the trained model
   */
  async predict(text) {
    try {
      if (!this.model) {
        throw new Error('Model not trained yet');
      }
      
      // Prepare input data
      const inputTensors = {};
      
      for (const column of this.featureColumns) {
        const preprocessor = this.preprocessors[column];
        
        if (preprocessor.type === 'text') {
          // Tokenize and convert to indices
          const tokens = text.toLowerCase().split(/\s+/).map(word => {
            return preprocessor.vocabulary[word] || 0; // 0 for unknown words
          });
          
          // Create tensor (add batch dimension)
          inputTensors[column] = tf.tensor2d([tokens], [1, tokens.length], 'int32');
        }
      }
      
      // Run prediction
      const prediction = await this.model.predict(inputTensors);
      const probabilities = prediction.dataSync();
      
      // Get inverse label map
      const inverseLabelMap = {};
      Object.entries(this.labelMap).forEach(([label, index]) => {
        inverseLabelMap[index] = label;
      });
      
      // Find predicted class
      const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
      const predictedClass = inverseLabelMap[predictedIndex];
      
      // Clean up tensors
      prediction.dispose();
      Object.values(inputTensors).forEach(tensor => tensor.dispose());
      
      return {
        predictedClass,
        probability: probabilities[predictedIndex],
        probabilities: Array.from(probabilities)
      };
    } catch (error) {
      this.logMessage(`Error during prediction: ${error.message}`);
      console.error(error);
      throw error;
    }
  }
  
  /**
   * Make API request to PHP backend
   */
  async apiRequest(action, additionalData = {}) {
    try {
      const requestData = {
        action,
        ...config.dbConfig,
        ...additionalData
      };
      
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      return {
        status: 'error',
        message: error.message
      };
    }
  }
  
  /**
   * Update status message in UI
   */
  updateStatus(message, isError = false) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.className = isError ? 'error' : 'status';
    }
    console.log(message);
  }
  
  /**
   * Update progress bar in UI
   */
  updateProgress(percentage) {
    if (this.progressElement) {
      this.progressElement.value = percentage;
      this.progressElement.textContent = `${percentage}%`;
    }
  }
  
  /**
   * Log message to UI
   */
  logMessage(message) {
    if (this.logElement) {
      const logEntry = document.createElement('div');
      logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      this.logElement.appendChild(logEntry);
      this.logElement.scrollTop = this.logElement.scrollHeight;
    }
    console.log(message);
  }
}

// Initialize the application when document is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new WordAI();
  
  // Initialize the application
  app.init();
  
  // Set up event listeners
  document.getElementById('train-button').addEventListener('click', () => {
    app.trainModel();
  });
  
  document.getElementById('evaluate-button').addEventListener('click', () => {
    app.evaluateModel();
  });
  
  document.getElementById('save-button').addEventListener('click', () => {
    app.saveModel();
  });
  
  document.getElementById('predict-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const textInput = document.getElementById('predict-input').value;
    const resultElement = document.getElementById('predict-result');
    
    if (!textInput) {
      resultElement.textContent = 'Please enter some text to predict';
      return;
    }
    
    try {
      app.updateStatus('Making prediction...');
      const result = await app.predict(textInput);
      
      resultElement.textContent = `Predicted class: ${result.predictedClass} (${(result.probability * 100).toFixed(2)}% confidence)`;
      app.updateStatus('Prediction complete');
    } catch (error) {
      resultElement.textContent = `Error: ${error.message}`;
      app.updateStatus(`Prediction error: ${error.message}`, true);
    }
  });
  
  // Make the app object available globally for debugging
  window.wordAI = app;
});

/**
 * Helper functions for text processing
 */
const TextProcessor = {
  /**
   * Tokenize text into words
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .split(/\s+/)            // Split on whitespace
      .filter(word => word.length > 0);
  },
  
  /**
   * Clean and normalize text
   */
  normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
      .trim()
      .replace(/\s+/g, ' '); // Normalize whitespace
  }
};

/**
 * Load a previously saved model
 */
async function loadSavedModel() {
  try {
    // Check if model exists in localStorage
    const modelInfo = JSON.parse(localStorage.getItem('word-ai-model-info') || 'null');
    if (!modelInfo) {
      console.error('No saved model found');
      return null;
    }
    
    // Load preprocessors and label mapping
    const preprocessors = JSON.parse(localStorage.getItem('word-ai-preprocessors') || 'null');
    const labelMap = JSON.parse(localStorage.getItem('word-ai-labelmap') || 'null');
    
    if (!preprocessors || !labelMap) {
      console.error('Missing preprocessors or label mapping for the model');
      return null;
    }
    
    // Load the model
    const model = await tf.loadLayersModel('localstorage://word-ai-model');
    
    return {
      model,
      preprocessors,
      labelMap,
      modelInfo
    };
  } catch (error) {
    console.error('Error loading saved model:', error);
    return null;
  }
}

/**
 * Make prediction with a loaded model
 */
async function predictWithLoadedModel(model, preprocessors, labelMap, text) {
  try {
    // Prepare input data
    const inputTensors = {};
    
    for (const column in preprocessors) {
      const preprocessor = preprocessors[column];
      
      if (preprocessor.type === 'text') {
        // Tokenize and convert to indices
        const tokens = TextProcessor.tokenize(text).map(word => {
          return preprocessor.vocabulary[word] || 0; // 0 for unknown words
        });
        
        // Create tensor (add batch dimension)
        inputTensors[column] = tf.tensor2d([tokens], [1, tokens.length], 'int32');
      }
    }
    
    // Run prediction
    const prediction = await model.predict(inputTensors);
    const probabilities = prediction.dataSync();
    
    // Find predicted class
    const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
    const predictedClass = labelMap[predictedIndex];
    
    // Clean up tensors
    prediction.dispose();
    Object.values(inputTensors).forEach(tensor => tensor.dispose());
    
    return {
      predictedClass,
      probability: probabilities[predictedIndex],
      probabilities: Array.from(probabilities)
    };
  } catch (error) {
    console.error('Error during prediction with loaded model:', error);
    throw error;
  }
}