import { formatDay } from "@/lib/format";
import type { ActivityEvent } from "@/lib/types";

/** Timeline of fictional demo events. Each date uses <time> for assistive tech. */
export default function ActivityList({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex gap-4 py-3 first:pt-0 last:pb-0">
          <time dateTime={e.date} className="w-14 shrink-0 font-mono text-xs leading-6 text-mist/55">
            {formatDay(e.date)}
          </time>
          <p className="text-sm text-mist/85">{e.text}</p>
        </li>
      ))}
    </ol>
  );
}
