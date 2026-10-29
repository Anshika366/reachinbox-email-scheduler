import React from "react";
import { Search, SlidersHorizontal, RotateCw } from "lucide-react";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing
}) => {
  return (
    <header className="h-16 border-b border-[#EAEAEA] bg-white px-6 flex items-center justify-between">
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            className="w-full bg-[#F5F5F7] border border-transparent rounded-full py-2 pl-9 pr-4 text-sm text-gray-800 placeholder-gray-400 focus:bg-white focus:border-gray-300 transition-all"
          />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          title="Filter"
          className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
        >
          <RotateCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );
};
