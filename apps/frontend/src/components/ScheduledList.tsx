import React from "react";
import { Clock, Star } from "lucide-react";
import { EmailRecord } from "../types";

interface ScheduledListProps {
  emails: EmailRecord[];
  onSelectEmail: (email: EmailRecord) => void;
  isLoading: boolean;
}

function formatScheduledBadge(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    return `${day} ${time}`;
  } catch {
    return isoDate;
  }
}

export const ScheduledList: React.FC<ScheduledListProps> = ({
  emails,
  onSelectEmail,
  isLoading
}) => {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-6 h-6 border-2 border-[#00A86B] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400 font-medium">Loading scheduled emails...</p>
        </div>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-400">
            <Clock className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No scheduled emails</p>
          <p className="text-xs text-gray-400 mt-1">
            Scheduled emails waiting in queue will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="divide-y divide-[#F0F0F0]">
        {emails.map((email) => {
          const badgeText = formatScheduledBadge(email.scheduled_at);
          const cleanBody = email.body.replace(/<[^>]+>/g, " ");

          return (
            <div
              key={email.id}
              onClick={() => onSelectEmail(email)}
              className="px-6 py-4 flex items-center justify-between hover:bg-[#F9FBF9] cursor-pointer transition-colors group"
            >
              <div className="flex items-center space-x-4 min-w-0 flex-1 pr-6">
                <span className="text-sm font-bold text-gray-900 shrink-0 w-36 truncate">
                  To: {email.recipient}
                </span>

                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-[#FFF7ED] border border-[#FFEDD5] text-[#EA580C] text-xs font-medium shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{badgeText}</span>
                </div>

                <div className="truncate text-xs text-gray-500">
                  <span className="font-semibold text-gray-800">{email.subject}</span>
                  <span className="mx-2 text-gray-300">-</span>
                  <span>{cleanBody}</span>
                </div>
              </div>

              <div className="shrink-0 flex items-center space-x-3 text-gray-300 group-hover:text-gray-400">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="hover:text-amber-400 transition-colors"
                >
                  <Star className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
