const { Connection, Request } = require("tedious");

// Build connection config
function getConnectionConfig() {
  const useWindowsAuth =
    String(process.env.SQL_USE_WINDOWS_AUTH).toLowerCase() === "true";

  const baseConfig = {
    server: process.env.SQL_SERVER || "localhost",
    options: {
      database: process.env.SQL_DATABASE || "AiMcqApp",
      encrypt: String(process.env.SQL_ENCRYPT).toLowerCase() === "true",
      trustServerCertificate: true,
      rowCollectionOnRequestCompletion: true,
      connectionTimeout: 30000, // Increased to 30 seconds
      requestTimeout: 30000,
    },
  };

  if (useWindowsAuth) {
    // Windows Authentication - try with default type
    return {
      ...baseConfig,
      authentication: {
        type: "default",
        options: {
          userName: `${process.env.SQL_DOMAIN || ""}\\${process.env.SQL_USER || ""}`,
          password: process.env.SQL_PASSWORD || "",
        },
      },
    };
  }

  // SQL Authentication (default)
  const sqlUser = process.env.SQL_USER || "sa";
  const sqlPassword = process.env.SQL_PASSWORD;
  
  if (!sqlPassword) {
    console.warn("⚠️  SQL_PASSWORD not set in .env - connection may fail");
  }

  return {
    ...baseConfig,
    authentication: {
      type: "default",
      options: {
        userName: sqlUser,
        password: sqlPassword || "",
      },
    },
  };
}

// Run a query and return rows as objects
function execQuery(sqlText, params = []) {
  return new Promise((resolve, reject) => {
    const connection = new Connection(getConnectionConfig());
    let completed = false;

    // Set timeout for the entire operation
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        connection.close();
        reject(new Error("Database connection timeout"));
      }
    }, 30000); // 30 second timeout

    connection.on("connect", (err) => {
      if (completed) return;
      if (err) {
        completed = true;
        clearTimeout(timeout);
        connection.close();
        return reject(err);
      }

      const request = new Request(sqlText, (err, rowCount, rows) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          connection.close();
          if (err) return reject(err);

          const result = rows.map((r) => {
            const obj = {};
            for (const c of r) obj[c.metadata.colName] = c.value;
            return obj;
          });

          resolve({ rowCount, rows: result });
        }
      });

      // Add parameters (optional). Supports { name, type, value, options } for e.g. Decimal precision/scale
      for (const p of params) {
        if (p.options) request.addParameter(p.name, p.type, p.value, p.options);
        else request.addParameter(p.name, p.type, p.value);
      }

      connection.execSql(request);
    });

    connection.on("error", (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        connection.close();
        reject(err);
      }
    });

    connection.connect();
  });
}

module.exports = { execQuery };
