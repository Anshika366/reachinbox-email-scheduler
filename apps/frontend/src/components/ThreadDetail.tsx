import React from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { EmailRecord } from "../types";

interface ThreadDetailProps {
  email: EmailRecord;
  onBack: () => void;
}

export const ThreadDetail: React.FC<ThreadDetailProps> = ({ email, onBack }) => {
  const d = new Date(email.sent_at || email.scheduled_at);
  const formattedTime = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const senderInitial = (email.sender_email[0] || "S").toUpperCase();

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className="h-14 border-b border-[#EAEAEA] px-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-gray-900 truncate max-w-xl">
            {email.subject}
          </h2>
        </div>

        {email.preview_url && (
          <a
            href={email.preview_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-emerald-500 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 transition-colors"
          >
            <span>{email.preview_url.includes("ethereal.email") && email.preview_url.includes("/message/") ? "View in Ethereal" : "View Live Preview"}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-8 max-w-4xl">
        <div className="flex items-start justify-between pb-6 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-base">
              {senderInitial}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-gray-900 text-sm">{email.sender_email.split("@")[0]}</span>
                <span className="text-xs text-gray-400">&lt;{email.sender_email}&gt;</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                to {email.recipient}
              </p>
            </div>
          </div>
          <span className="text-xs text-gray-400 font-medium">{formattedTime}</span>
        </div>

        <div className="py-6 text-sm text-gray-800 leading-relaxed">
          <div
            dangerouslySetInnerHTML={{ __html: email.body }}
            className="prose prose-sm max-w-none"
          />
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Delivery Metadata
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-gray-400 block text-[11px]">Status</span>
              <span className="font-semibold text-gray-800 capitalize mt-0.5 block">{email.status}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-gray-400 block text-[11px]">Job ID</span>
              <span className="font-semibold text-gray-800 truncate mt-0.5 block" title={email.bullmq_job_id || "N/A"}>
                {email.bullmq_job_id || "N/A"}
              </span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-gray-400 block text-[11px]">Retry Count</span>
              <span className="font-semibold text-gray-800 mt-0.5 block">{email.retry_count}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <span className="text-gray-400 block text-[11px]">Min Delay</span>
              <span className="font-semibold text-gray-800 mt-0.5 block">{email.min_delay_ms} ms</span>
            </div>
            {email.error_details && (
              <div className="col-span-2 md:col-span-4 bg-amber-50 p-3.5 rounded-lg border border-amber-200 text-amber-900 mt-1">
                <span className="font-bold block text-xs mb-1 text-amber-950">Delivery &amp; Recovery Notice</span>
                <span className="block text-xs leading-relaxed text-amber-800">{email.error_details}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
