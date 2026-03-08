function formatUtcDateOnly(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateRange(query = {}) {
  const today = startOfUtcDay(new Date());
  const toInput = query.to;
  const fromInput = query.from;

  const toDate = toInput ? parseDateOnly(toInput) : today;
  if (!toDate) {
    const error = new Error("Invalid to date. Use YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }

  const fromDate = fromInput
    ? parseDateOnly(fromInput)
    : new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() - 6));
  if (!fromDate) {
    const error = new Error("Invalid from date. Use YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }
  if (fromDate > toDate) {
    const error = new Error("from date must be on or before to date.");
    error.status = 400;
    throw error;
  }

  return {
    fromDate,
    toDate,
    fromDateString: formatUtcDateOnly(fromDate),
    toDateString: formatUtcDateOnly(toDate),
  };
}

module.exports = {
  parseDateRange,
  formatUtcDateOnly,
};

