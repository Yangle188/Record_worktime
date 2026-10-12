/**
 * 业务日归属（D-008 / PRD §4.5）。
 *
 * 规则：段归属「开始日」；业务日边界默认 04:00（凌晨 4 点前算前一天），
 * 因此跨 0 点熬夜工作的段仍归属开始日。所有计算使用**本地时区**。
 */

/** 把一个时间戳映射为它所属的业务日 `YYYY-MM-DD`。 */
export function businessDayOf(
  timestamp: number,
  boundaryMinutes: number,
): string {
  const shifted = new Date(timestamp - boundaryMinutes * 60_000);
  return toDateString(shifted);
}

/** 业务日的半开区间 `[start, end)`，用于查询与汇总。 */
export function businessDayRange(
  businessDay: string,
  boundaryMinutes: number,
): { start: number; end: number } {
  const [year, month, day] = businessDay.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  start.setMinutes(start.getMinutes() + boundaryMinutes);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/** 今天（按业务日）的标识。 */
export function currentBusinessDay(now: number, boundaryMinutes: number): string {
  return businessDayOf(now, boundaryMinutes);
}

/** 业务日区间在时间轴上的展示范围。 */
export function businessDayClockRange(
  businessDay: string,
  boundaryMinutes: number,
): { startMinutes: number; endMinutes: number } {
  const { start, end } = businessDayRange(businessDay, boundaryMinutes);
  const startDate = new Date(start);
  const spanHours = (end - start) / 3_600_000;
  return {
    startMinutes: startDate.getHours() * 60 + startDate.getMinutes(),
    endMinutes: startDate.getHours() * 60 + startDate.getMinutes() + spanHours * 60,
  };
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
