require("dotenv").config({ path: __dirname + "/.env" });
const { Connection, Request } = require("tedious");

console.log("Environment variables loaded:");
console.log("SQL_USE_WINDOWS_AUTH:", process.env.SQL_USE_WINDOWS_AUTH);
console.log("SQL_DOMAIN:", process.env.SQL_DOMAIN);
console.log("SQL_USER:", process.env.SQL_USER);
console.log("SQL_SERVER:", process.env.SQL_SERVER);
console.log("SQL_DATABASE:", process.env.SQL_DATABASE);

const useWindowsAuth = String(process.env.SQL_USE_WINDOWS_AUTH).toLowerCase() === "true";
console.log("useWindowsAuth evaluated to:", useWindowsAuth);


const config = {
  server: process.env.SQL_SERVER || "localhost",
  options: {
    encrypt: String(process.env.SQL_ENCRYPT).toLowerCase() === "true",
    trustServerCertificate: true,
    rowCollectionOnRequestCompletion: true,
    database: process.env.SQL_DATABASE || "AiMcqApp",
    connectionTimeout: 30000,
    requestTimeout: 30000,
  },
  authentication: useWindowsAuth
    ? {
        type: "default",
        options: {
          userName: `${process.env.SQL_DOMAIN || ""}\\${process.env.SQL_USER || ""}`,
          password: process.env.SQL_PASSWORD || "",
        },
      }
    : {
        type: "default",
        options: {
          userName: process.env.SQL_USER || "sa",
          password: process.env.SQL_PASSWORD || "",
        },
      },
};

console.log("Testing SQL Server connection...");
console.log(`Config: server="${config.server}", database="${config.options.database}", auth type="${config.authentication.type}"`);

const conn = new Connection(config);

conn.on("connect", (err) => {
  if (err) {
    console.log("Connection error:", err.message);
    process.exit(1);
  }
  
  console.log("✓ Connected to SQL Server");
  
  // Test query
  const request = new Request(
    "SELECT 1 AS ok",
    (err, rowCount, rows) => {
      if (err) {
        console.log("Query error:", err.message);
      } else {
        console.log("✓ Query executed successfully");
        console.log("Result:", rows);
      }
      conn.close();
      process.exit(0);
    }
  );
  
  conn.execSql(request);
});

conn.on("error", (err) => {
  console.log("❌ Connection error:", err.message);
  process.exit(1);
});

conn.on("infoMessage", (info) => {
  console.log("ℹ️ " + info.message);
});

console.log("Testing SQL Server connection...");
console.log("Config:", JSON.stringify({ server: config.server, database: config.options.database, instanceName: config.options.instanceName }));
conn.connect();


