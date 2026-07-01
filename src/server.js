// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const helmet = require('helmet');
// const morgan = require('morgan');
// const connectDB = require('./config/db');
// const chalk = require('chalk');
// const logger = require('./shared/utils/logger');

// const app = express();

// // Connect Database
// connectDB();

// // Global Middlewares
// app.use(helmet());
// // CORS Configuration
// const allowedOrigins = [
//   'http://localhost:3000',
//   'http://localhost:3001',
//   'http://localhost:3002',
//   'http://localhost:5173',
// ];

// if (process.env.BRANCH_FRONTEND_URL) {
//   allowedOrigins.push(process.env.BRANCH_FRONTEND_URL.trim());
// }
// if (process.env.SUPER_ADMIN_FRONTEND_URL) {
//   allowedOrigins.push(process.env.SUPER_ADMIN_FRONTEND_URL.trim());
// }

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       if (!origin) return callback(null, true);

//       if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
//         callback(null, true);
//       } else {
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     credentials: true,
//     optionsSuccessStatus: 200,
//   })
// );
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // HTTP Request Logging
// app.use(
//   morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
//     stream: {
//       write: (message) => logger.info(message.trim()),
//     },
//   })
// );

// // Register Modules
// const { initMenuModule }  = require('./modules/menu');
// const { initOrderModule } = require('./modules/order');
// const { initPromoModule } = require('./modules/promo');
// const { initExpenseModule } = require('./modules/expense');

// initMenuModule(app);
// initOrderModule(app);
// initPromoModule(app);
// initExpenseModule(app);

// // Health Check Route
// app.get('/api/health', (req, res) => {
//   res.status(200).json({ status: 'OK', message: 'RMS Backend is running smoothly.' });
// });

// // Port configuration
// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {
//   logger.info(chalk.cyan.bold(`Server is running on port ${PORT}`));
// });



const app = require("./app");

const logger = require("./shared/utils/logger");
const chalk = require("chalk");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(
    chalk.cyan.bold(`Server is running on port ${PORT}`)
  );
});
