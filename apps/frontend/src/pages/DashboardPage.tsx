import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "../components/Sidebar";
import { Header } from "../components/Header";
import { ScheduledList } from "../components/ScheduledList";
import { SentList } from "../components/SentList";
import { ThreadDetail } from "../components/ThreadDetail";
import { ComposeModal } from "../components/ComposeModal";
import { User, Sender, EmailRecord, SlackStatus } from "../types";
import { emailApi, senderApi, slackApi } from "../services/api";

interface DashboardPageProps {
  user: User;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onLogout }) => {
  const [currentTab, setCurrentTab] = useState<"scheduled" | "sent">("scheduled");
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);

  const [scheduledEmails, setScheduledEmails] = useState<EmailRecord[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailRecord[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);

  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const [counts, scheduledRes, sentRes, sendersRes, slackRes] = await Promise.all([
        emailApi.getCounts(),
        emailApi.getScheduled(),
        emailApi.getSent(),
        senderApi.getSenders(),
        slackApi.getStatus()
      ]);

      setScheduledCount(counts.scheduled);
      setSentCount(counts.sent);
      setScheduledEmails(scheduledRes.emails);
      setSentEmails(sentRes.emails);
      setSenders(sendersRes);
      setSlackStatus(slackRes);
    } catch {
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      fetchData();
      return;
    }

    try {
      const result = await emailApi.searchEmails(
        query,
        currentTab === "scheduled" ? "scheduled" : "sent"
      );
      if (currentTab === "scheduled") {
        setScheduledEmails(result.emails);
      } else {
        setSentEmails(result.emails);
      }
    } catch {}
  };

  const handleConnectSlack = async () => {
    try {
      const url = await slackApi.getAuthUrl();
      window.location.href = url;
    } catch {
      alert("Unable to generate Slack authorization URL. Ensure Slack credentials are set.");
    }
  };

  const handleDisconnectSlack = async () => {
    try {
      await slackApi.disconnect();
      setSlackStatus({ isConnected: false });
    } catch {}
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setIsComposeOpen(false);
          setSelectedEmail(null);
        }}
        onOpenCompose={() => {
          setIsComposeOpen(true);
          setSelectedEmail(null);
        }}
        user={user}
        scheduledCount={scheduledCount}
        sentCount={sentCount}
        slackStatus={slackStatus}
        onConnectSlack={handleConnectSlack}
        onDisconnectSlack={handleDisconnectSlack}
        onLogout={onLogout}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          searchQuery={searchQuery}
          onSearchChange={handleSearch}
          onRefresh={() => fetchData(true)}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 flex overflow-hidden">
          {isComposeOpen ? (
            <ComposeModal
              senders={senders}
              onClose={() => setIsComposeOpen(false)}
              onCampaignCreated={() => {
                fetchData(true);
                setCurrentTab("scheduled");
              }}
            />
          ) : selectedEmail ? (
            <ThreadDetail
              email={selectedEmail}
              onBack={() => setSelectedEmail(null)}
            />
          ) : currentTab === "scheduled" ? (
            <ScheduledList
              emails={scheduledEmails}
              onSelectEmail={(email) => setSelectedEmail(email)}
              isLoading={isLoading}
            />
          ) : (
            <SentList
              emails={sentEmails}
              onSelectEmail={(email) => setSelectedEmail(email)}
              isLoading={isLoading}
            />
          )}
        </main>
      </div>
    </div>
  );
};
