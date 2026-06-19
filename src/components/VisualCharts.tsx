import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { DomainRow } from "../types";
import { LayoutGrid, Globe, Newspaper, HelpCircle, HeartHandshake } from "lucide-react";

interface VisualChartsProps {
  rows: DomainRow[];
}

export default function VisualCharts({ rows }: VisualChartsProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const successes = rows.filter((r) => r.status === "success");

  // Calculations
  const total = rows.length;
  const processed = successes.length;
  const pending = rows.filter((r) => r.status === "pending").length;

  // Category counts
  const ecom = successes.filter((r) => r.category === "e-commerce").length;
  const tech = successes.filter((r) => r.category === "technology").length;
  const blog = successes.filter((r) => r.category === "blogs").length;
  const other = successes.filter((r) => r.category === "other").length;

  const isNewsNum = successes.filter((r) => r.isNewsPublisher === "Yes").length;
  const isNotNewsNum = successes.filter((r) => r.isNewsPublisher === "No").length;

  const catData = [
    { name: "E-Commerce", value: ecom, color: "#6366f1" }, // indigo
    { name: "Technology", value: tech, color: "#06b6d4" }, // cyan
    { name: "Blogs", value: blog, color: "#f59e0b" },      // amber
    { name: "Other (Standard)", value: other, color: "#9ca3af" },  // gray
  ].filter((d) => d.value > 0);

  const newsData = [
    { name: "News Publisher", value: isNewsNum, color: "#ef4444" }, // red
    { name: "Standard Site", value: isNotNewsNum, color: "#10b981" }, // emerald
  ].filter((d) => d.value > 0);

  // If no items have been classified yet, show empty/graceful guide state
  if (processed === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-gray-50/50 rounded-2xl border border-dashed border-gray-200 mt-6 max-w-2xl mx-auto">
        <HeartHandshake className="h-10 w-10 text-gray-400 mb-3" />
        <h3 className="font-display font-medium text-gray-900 text-sm">No Classifications Generated Yet</h3>
        <p className="text-gray-500 text-xs mt-1 max-w-sm">
          Once you run the automated Gemini classifier on your list of domains, rich visual analytics, break-down ratios, and news publisher charts will render here instantly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bento Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Total Domains Loaded</span>
            <Globe className="h-4 w-4 text-gray-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-display font-bold text-gray-900">{total}</span>
            <span className="text-[10px] text-gray-400">found in sheet</span>
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Classified Successfully</span>
            <LayoutGrid className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-display font-bold text-emerald-600">{processed}</span>
            <span className="text-[10px] text-gray-400">({Math.round((processed / total) * 100)}%)</span>
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">News Publishers</span>
            <Newspaper className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-display font-bold text-indigo-600">{isNewsNum}</span>
            <span className="text-[10px] text-gray-400">websites detected</span>
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Pending Run</span>
            <HelpCircle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-display font-bold text-amber-600">{pending}</span>
            <span className="text-[10px] text-gray-400">waiting in queue</span>
          </div>
        </div>
      </div>

      {/* Charts Display */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown (Pie Chart) */}
        <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-xs flex flex-col min-h-0 min-w-0">
          <h3 className="font-display font-semibold text-gray-900 text-sm mb-4">
            Proportional Category Break-down
          </h3>
          <div className="h-64 w-full relative min-h-0 min-w-0">
            {catData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-400">No category breakdown available</div>
            ) : mounted ? (
              <ResponsiveContainer width="99%" height={240}>
                <PieChart>
                  <Pie
                    data={catData}
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {catData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid #f3f4f6" }}
                    itemStyle={{ fontSize: "11px" }}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>

        {/* News Publisher Breakdown (Bar Chart) */}
        <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-xs flex flex-col min-h-0 min-w-0">
          <h3 className="font-display font-semibold text-gray-900 text-sm mb-4">
            News Publisher Status
          </h3>
          <div className="h-64 w-full relative min-h-0 min-w-0">
            {newsData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-400">No news publisher data available</div>
            ) : mounted ? (
              <ResponsiveContainer width="99%" height={240}>
                <BarChart data={newsData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid #f3f4f6" }}
                    itemStyle={{ fontSize: "11px" }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={45}>
                    {newsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
