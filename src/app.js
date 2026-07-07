require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const chalk = require("chalk");

const connectDB = require("./config/db");
const logger = require("./shared/utils/logger");

const app = express();


connectDB();


app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    logger.error(`Database connection middleware error: ${error.message}`);
    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed. Please try again later.",
    });
  }
});

app.use(helmet());


const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
];

if (process.env.BRANCH_FRONTEND_URL) {
  allowedOrigins.push(process.env.BRANCH_FRONTEND_URL.trim());
}

if (process.env.SUPER_ADMIN_FRONTEND_URL) {
  allowedOrigins.push(process.env.SUPER_ADMIN_FRONTEND_URL.trim());
}

if (process.env.USER_FRONTEND_URL) {
  allowedOrigins.push(process.env.USER_FRONTEND_URL.trim());
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);


app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use(
  morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }),
);


const { initMenuModule } = require("./modules/menu");
const { initOrderModule } = require("./modules/order");
const { initPromoModule } = require("./modules/promo");
const { initExpenseModule } = require("./modules/expense");
const { initPaymentModule } = require("./modules/payment");

initMenuModule(app);
initOrderModule(app);
initPromoModule(app);
initExpenseModule(app);
initPaymentModule(app);


app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "RMS Backend is running smoothly.",
  });
});

module.exports = app;
