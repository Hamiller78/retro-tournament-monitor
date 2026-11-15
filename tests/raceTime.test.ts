import { describe, expect, it } from 'vitest';
import { formatRaceTime, parseRaceTime } from '../client/src/raceTime';

describe('racing times', () => {
  it('parses minutes and seconds with optional decimal fractions', () => {
    expect(parseRaceTime('01:23')).toBe(83);
    expect(parseRaceTime('1:23.45')).toBe(83.45);
    expect(parseRaceTime('02:03,500')).toBe(123.5);
    expect(parseRaceTime('100:00')).toBe(6000);
    for (const invalid of ['83', '1:3', '01:60', '-1:00', '1:00.1234567', '']) expect(parseRaceTime(invalid)).toBeNull();
  });
  it('formats stored seconds without changing the underlying value', () => {
    expect(formatRaceTime(83)).toBe('01:23');
    expect(formatRaceTime(83.45)).toBe('01:23.45');
    expect(formatRaceTime(0.005)).toBe('00:00.005');
    expect(formatRaceTime(6000)).toBe('100:00');
  });
});
