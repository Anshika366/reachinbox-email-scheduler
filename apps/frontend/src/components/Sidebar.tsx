import React, { useState } from "react";
import { Clock, Send, Plus, ChevronDown, LogOut, CheckCircle2 } from "lucide-react";
import { User, SlackStatus } from "../types";

interface SidebarProps {
  currentTab: "scheduled" | "sent";
  onSelectTab: (tab: "scheduled" | "sent") => void;
  onOpenCompose: () => void;
  user: User | null;
  scheduledCount: number;
  sentCount: number;
  slackStatus: SlackStatus | null;
  onConnectSlack: () => void;
  onDisconnectSlack: () => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenCompose,
  user,
  scheduledCount,
  sentCount,
  slackStatus,
  onConnectSlack,
  onDisconnectSlack,
  onLogout
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  React.useEffect(() => {
    setAvatarError(false);
  }, [user?.avatarUrl]);

  const displayName = user?.name || "Oliver Brown";
  const displayEmail = user?.email || "oliver.brown@domain.io";
  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "OB";

  return (
    <aside className="w-64 bg-[#FBFBFC] border-r border-[#EAEAEA] flex flex-col h-screen select-none">
      <div className="px-4 pt-5 pb-4">
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200"
          >
            <div className="flex items-center space-x-3 text-left overflow-hidden">
              <div className="w-9 h-9 rounded-full bg-[#E2E8F0] text-gray-700 flex items-center justify-center font-semibold text-xs shrink-0 overflow-hidden select-none">
                {user?.avatarUrl && !avatarError ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="truncate">
                <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
                <p className="text-xs text-gray-500 truncate leading-tight mt-0.5">{displayEmail}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          </button>

          {showUserMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20">
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400 font-medium">Signed in as</p>
                <p className="text-xs font-semibold text-gray-800 truncate">{displayEmail}</p>
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onLogout();
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 mb-6">
        <button
          onClick={onOpenCompose}
          className="w-full py-2.5 px-4 rounded-xl border border-[#00A86B] text-[#00A86B] font-semibold text-sm hover:bg-[#E8F8F0] transition-colors flex items-center justify-center space-x-2 bg-white shadow-xs"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Compose</span>
        </button>
      </div>

      <div className="px-4 flex-1">
        <p className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase mb-2 px-3">
          CORE
        </p>
        <nav className="space-y-1">
          <button
            onClick={() => onSelectTab("scheduled")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              currentTab === "scheduled"
                ? "bg-[#EAEAEA] text-gray-900 font-semibold"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-center space-x-3">
              <Clock className="w-4 h-4 text-gray-500" />
              <span>Scheduled</span>
            </div>
            <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 font-medium">
              {scheduledCount}
            </span>
          </button>

          <button
            onClick={() => onSelectTab("sent")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              currentTab === "sent"
                ? "bg-[#EAEAEA] text-gray-900 font-semibold"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-center space-x-3">
              <Send className="w-4 h-4 text-gray-500" />
              <span>Sent</span>
            </div>
            <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 font-medium">
              {sentCount}
            </span>
          </button>
        </nav>
      </div>

      <div className="p-4 border-t border-[#EAEAEA] bg-white">
        {slackStatus?.isConnected ? (
          <div className="bg-[#F8FAF9] p-3 rounded-xl border border-emerald-200">
            <div className="flex items-center space-x-2 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Slack Connected</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1 truncate">
              {slackStatus.teamName}
            </p>
            <button
              onClick={onDisconnectSlack}
              className="text-[11px] text-gray-400 hover:text-red-500 font-medium mt-1 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={onConnectSlack}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-gray-400"></span>
            <span>Connect Slack</span>
          </button>
        )}
      </div>
    </aside>
  );
};
