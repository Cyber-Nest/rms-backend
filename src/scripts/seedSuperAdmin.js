require("dotenv").config();
const connectDB = require("../config/db");
const SuperAdmin = require("../modules/company/models/superAdmin.model");

async function seed() {
  try {
    await connectDB();
    console.log("\n📦 Connected to MongoDB. Seeding Super Admin account...");

    // Remove old superadmin records for clean reset
    await SuperAdmin.deleteMany({ email: "admin@cybernest.com" });

    const admin = new SuperAdmin({
      name: "Cyber Nest Super Admin",
      email: "admin@cybernest.com",
      password: "admin123",
      role: "super_admin",
    });

    await admin.save();

    console.log("\n==================================================");
    console.log("  SUPER ADMIN ACCOUNT SEEDED SUCCESSFULLY!");
    console.log("==================================================");
    console.log("  Portal URL : http://localhost:3002/login");
    console.log("  Email      : admin@cybernest.com");
    console.log("  Password   : admin123");
    console.log("==================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("\n Super Admin Seed Error:", err.message);
    process.exit(1);
  }
}

seed();
