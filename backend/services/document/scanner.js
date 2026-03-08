async function scanFile(_filePath) {
  // Malware scanner hook.
  // Default dev behavior is PASS; production can wire external scanner here.
  return { result: "PASS" };
}

module.exports = {
  scanFile,
};

