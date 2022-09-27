import dayjs from 'dayjs'
import dayjs_utc from 'dayjs/plugin/utc'
import dayjs_duration from 'dayjs/plugin/duration'

dayjs.extend(dayjs_utc)
dayjs.extend(dayjs_duration)

export default dayjs