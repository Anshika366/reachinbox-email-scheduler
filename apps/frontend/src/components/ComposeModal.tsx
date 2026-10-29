import React, { useState, useRef } from "react";
import {
  ArrowLeft,
  Clock,
  Upload,
  X,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  Calendar,
  Sparkles
} from "lucide-react";
import { Sender } from "../types";
import { emailApi } from "../services/api";

interface ComposeModalProps {
  senders: Sender[];
  onClose: () => void;
  onCampaignCreated: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  senders,
  onClose,
  onCampaignCreated
}) => {
  const [selectedSenderId, setSelectedSenderId] = useState<string>(
    senders[0]?.id || ""
  );
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [delayBetweenEmailsSec, setDelayBetweenEmailsSec] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(100);

  const [showSendLater, setShowSendLater] = useState<boolean>(true);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addRecipient = () => {
    const trimmed = recipientInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmed && emailRegex.test(trimmed) && !recipients.includes(trimmed)) {
      setRecipients([...recipients, trimmed]);
      setRecipientInput("");
    }
  };

  const removeRecipient = (indexToRemove: number) => {
    setRecipients(recipients.filter((_, idx) => idx !== indexToRemove));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await emailApi.uploadCsv(file);
      const merged = Array.from(new Set([...recipients, ...data.validRecipients]));
      setRecipients(merged);
      setUploadFeedback(`Imported ${data.totalValid} valid recipients.`);
      if (data.totalInvalid > 0) {
        setUploadFeedback(
          `Imported ${data.totalValid} valid recipients. (${data.totalInvalid} invalid skipped)`
        );
      }
    } catch {
      setErrorMessage("Failed to parse CSV file");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const setPresetTime = (preset: "tomorrow" | "10am" | "11am" | "3pm") => {
    const target = new Date();
    target.setDate(target.getDate() + 1);

    if (preset === "tomorrow") {
      target.setHours(9, 0, 0, 0);
    } else if (preset === "10am") {
      target.setHours(10, 0, 0, 0);
    } else if (preset === "11am") {
      target.setHours(11, 0, 0, 0);
    } else if (preset === "3pm") {
      target.setHours(15, 0, 0, 0);
    }

    const localIso = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setScheduledDateTime(localIso);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const allRecipients = [...recipients];
    const pendingInput = recipientInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (pendingInput && emailRegex.test(pendingInput) && !allRecipients.includes(pendingInput)) {
      allRecipients.push(pendingInput);
    }

    if (!selectedSenderId) {
      setErrorMessage("Please select a sender identity");
      return;
    }

    if (allRecipients.length === 0) {
      setErrorMessage("Please specify at least one recipient");
      return;
    }

    if (!subject.trim()) {
      setErrorMessage("Please enter an email subject");
      return;
    }

    if (!body.trim()) {
      setErrorMessage("Please enter an email body");
      return;
    }

    const parsedScheduledTime = new Date(scheduledDateTime).getTime();
    if (isNaN(parsedScheduledTime) || parsedScheduledTime < Date.now() - 60000) {
      setErrorMessage("Scheduled time cannot be in the past");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const scheduledAtIso = new Date(scheduledDateTime).toISOString();
      const idempotencyKey = `camp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      await emailApi.scheduleCampaign({
        senderId: selectedSenderId,
        recipients: allRecipients,
        subject,
        body,
        scheduledAt: scheduledAtIso,
        minDelayMs: delayBetweenEmailsSec * 1000,
        hourlyLimit,
        idempotencyKey
      });

      onCampaignCreated();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.error || "Failed to schedule email campaign";
      setErrorMessage(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className="h-14 border-b border-[#EAEAEA] px-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-gray-900">Compose New Email</h2>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowSendLater(!showSendLater)}
            className={`p-2 rounded-lg border transition-colors ${
              showSendLater
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
            title="Schedule Send"
          >
            <Clock className="w-4 h-4" />
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl bg-[#00A86B] hover:bg-[#008f5a] text-white text-xs font-semibold tracking-wide transition-colors flex items-center space-x-1.5 disabled:opacity-50 shadow-sm"
          >
            {isSubmitting && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            <span>{showSendLater ? "Send Later" : "Send"}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-y-auto p-6 max-w-4xl border-r border-[#EAEAEA]">
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
              {errorMessage}
            </div>
          )}

          {uploadFeedback && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs">
              {uploadFeedback}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center text-xs">
              <span className="w-20 text-gray-400 font-medium shrink-0">From</span>
              <select
                value={selectedSenderId}
                onChange={(e) => setSelectedSenderId(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-800 bg-white focus:border-emerald-500 font-medium"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-start text-xs">
              <span className="w-20 text-gray-400 font-medium pt-2 shrink-0">To</span>
              <div className="flex-1 border border-gray-200 rounded-lg p-2 min-h-[42px] flex flex-wrap gap-1.5 items-center bg-white focus-within:border-emerald-500">
                {recipients.map((rec, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#E8F8F0] text-[#00A86B] text-xs font-semibold"
                  >
                    <span>{rec}</span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(idx)}
                      className="hover:text-emerald-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                <input
                  type="text"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  placeholder={recipients.length === 0 ? "recipient@example.com" : ""}
                  className="flex-1 min-w-[140px] text-xs text-gray-800 placeholder-gray-400 bg-transparent py-1"
                />

                <div className="shrink-0 ml-auto">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv,.txt"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center space-x-1 text-[#00A86B] hover:text-[#008f5a] font-semibold text-xs px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload List</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center text-xs">
              <span className="w-20 text-gray-400 font-medium shrink-0">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 placeholder-gray-400 focus:border-emerald-500 font-medium"
              />
            </div>

            <div className="flex items-center space-x-6 text-xs pt-1">
              <div className="flex items-center space-x-2">
                <span className="text-gray-400 font-medium">Delay between 2 emails</span>
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={delayBetweenEmailsSec}
                  onChange={(e) => setDelayBetweenEmailsSec(parseInt(e.target.value || "0", 10))}
                  className="w-16 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-800 text-center font-medium focus:border-emerald-500"
                />
                <span className="text-gray-400">sec</span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-gray-400 font-medium">Hourly Limit</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value || "1", 10))}
                  className="w-16 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-800 text-center font-medium focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden mt-3 flex-1 flex flex-col min-h-[300px]">
              <div className="bg-[#FBFBFC] border-b border-gray-200 px-3 py-2 flex items-center space-x-2 text-gray-500 text-xs">
                <button
                  type="button"
                  onClick={() => setBody(body + "<b></b>")}
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Bold"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setBody(body + "<i></i>")}
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Italic"
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setBody(body + "<u></u>")}
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Underline"
                >
                  <Underline className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-4 bg-gray-300" />
                <button
                  type="button"
                  onClick={() => setBody(body + "<ul><li></li></ul>")}
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Bullet list"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setBody(body + "<ol><li></li></ol>")}
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Numbered list"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1 hover:bg-gray-200 rounded"
                  title="Align"
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-4 bg-gray-300" />
                <button
                  type="button"
                  onClick={() => {
                    const sampleCallout = `<div style="background-color:#FEF3C7;border-left:4px solid #F59E0B;padding:12px;margin:8px 0;font-size:13px;color:#92400E;"><b>Extremely Exclusive</b>—Only 4 Spots Worldwide Per Year</div>`;
                    setBody(body + sampleCallout);
                  }}
                  className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-amber-700 bg-amber-50 hover:bg-amber-100 font-medium text-[11px]"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Insert Callout</span>
                </button>
              </div>

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type Your Reply..."
                className="flex-1 p-4 text-xs text-gray-800 placeholder-gray-400 focus:outline-none resize-none leading-relaxed"
                rows={12}
              />
            </div>
          </div>
        </div>

        {showSendLater && (
          <div className="w-80 bg-[#FAFAFB] p-6 overflow-y-auto select-none border-l border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
              Send Later
            </h3>

            <div className="mb-6">
              <label className="block text-xs text-gray-500 font-medium mb-1.5">
                Pick date & time
              </label>
              <div className="relative">
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 font-medium focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setPresetTime("tomorrow")}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Tomorrow</span>
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => setPresetTime("10am")}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Tomorrow, 10:00 AM</span>
                <Clock className="w-3.5 h-3.5 text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => setPresetTime("11am")}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Tomorrow, 11:00 AM</span>
                <Clock className="w-3.5 h-3.5 text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => setPresetTime("3pm")}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors flex items-center justify-between"
              >
                <span>Tomorrow, 3:00 PM</span>
                <Clock className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
