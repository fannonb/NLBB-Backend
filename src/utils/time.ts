export const nowIso = () => new Date().toISOString();

export const addDaysIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

export const toMonthRef = (d = new Date()) => {
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}`;
};
