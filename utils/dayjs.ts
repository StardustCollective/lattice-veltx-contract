import dayjs from 'dayjs';
import dayjs_duration from 'dayjs/plugin/duration.js';

export const configureDayJsLib = () => {
  dayjs.extend(dayjs_duration);
};
