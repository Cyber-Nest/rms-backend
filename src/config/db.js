const mongoose = require('mongoose');
const chalk = require('chalk');
const logger = require('../shared/utils/logger');

// Global caching for serverless environments
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: true,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    };

    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts).then((mongooseInstance) => {
      logger.info(chalk.green.bold(`MongoDB Connected: ${mongooseInstance.connection.host}`));
      return mongooseInstance;
    }).catch((error) => {
      logger.error(chalk.red.bold(`Database connection error: ${error.message}`));
      cached.promise = null; // reset to try again on next invocation
      throw error;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
};

module.exports = connectDB;

