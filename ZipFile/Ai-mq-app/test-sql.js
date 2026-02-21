const { Connection, Request } = require("tedious");

const config = {
  server: ".",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    rowCollectionOnRequestCompletion: true,
  },
  authentication: {
    type: "ntlm",
    options: {
      domain: "",
      userName: "",
      password: "",
    },
  },
};

const conn = new Connection(config);

conn.on("connect", (err) => {
  if (err) {
    console.log("Connection error:", err.message);
    process.exit(1);
  }
  
  console.log("✓ Connected to SQL Server");
  
  // List databases
  const request = new Request(
    "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')",
    (err, rowCount, rows) => {
      if (err) {
        console.log("Query error:", err.message);
      } else {
        console.log("Available databases:");
        rows.forEach(row => {
          console.log("  -", row[0].value);
        });
      }
      conn.close();
      process.exit(0);
    }
  );
  
  conn.execSql(request);
});

conn.on("error", (err) => {
  console.log("Connection error:", err.message);
  process.exit(1);
});

console.log("Testing SQL Server connection...");
conn.connect();
