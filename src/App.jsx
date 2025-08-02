import React, { useState, useEffect, useMemo, memo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

// --- CONSTANTS ---
const DAY_NAME_MAPPING = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INITIAL_CAPITAL = 500000;
const TRADES_PER_PAGE = 20; // Number of trades to show per page/load

// --- HELPER FUNCTIONS ---
/**
 * Generates a large set of sample trades for demonstration purposes.
 * @param {number} count - The number of trades to generate.
 * @returns {Array<Object>} An array of trade objects.
 */
const generateSampleTrades = (count) => {
    const trades = [];
    let currentDate = new Date('2023-01-01');

    for (let i = 0; i < count; i++) {
        currentDate.setDate(currentDate.getDate() + 1);
        // Skip weekends
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            i--; // Decrement i to ensure we still get the desired count of trades
            continue;
        }

        // Generate somewhat realistic P&L
        const isProfit = Math.random() > 0.45; // 55% win rate
        const pnlMagnitude = isProfit ? Math.random() * 25000 : Math.random() * 15000;
        const grossPnl = isProfit ? pnlMagnitude : -pnlMagnitude;
        const taxesAndCharges = Math.abs(grossPnl) * (Math.random() * 0.05 + 0.02); // 2-7% charges

        trades.push({
            id: `trade-sample-${i}`,
            date: currentDate.toISOString().split('T')[0],
            day: DAY_NAME_MAPPING[currentDate.getDay()],
            grossPnl: parseFloat(grossPnl.toFixed(2)),
            taxesAndCharges: parseFloat(taxesAndCharges.toFixed(2)),
            capitalDeployed: INITIAL_CAPITAL,
        });
    }
    return trades;
};


/**
 * Formats a number into a precise Indian Rupee currency string.
 * Used for tooltips where exact values are needed.
 * @param {number} value - The number to format.
 * @returns {string} - The formatted currency string.
 */
const formatCurrencyPrecise = (value) => `₹${(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Formats a number into a compact, readable Indian Rupee currency string,
 * abbreviating Lakhs (L) and Crores (Cr).
 * Used for display in metric cards.
 * @param {number} value - The number to format.
 * @returns {string} - The compact, formatted currency string.
 */
const formatCurrencyCompact = (value) => {
    const num = value || 0;
    if (Math.abs(num) >= 10000000) {
        return `₹${(num / 10000000).toFixed(2)}Cr`;
    }
    if (Math.abs(num) >= 100000) {
        return `₹${(num / 100000).toFixed(2)}L`;
    }
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercentage = (value) => `${(value || 0).toFixed(2)}%`;

/**
 * Formats a date string into a compact format for chart axes (e.g., "Jan '23").
 * @param {string} tickItem - The date string from the chart data.
 * @returns {string} - The formatted date string.
 */
const formatDateForAxis = (tickItem) => {
    const date = new Date(tickItem);
    // Use en-US locale for 'Mon YY' format, which is robust.
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};


// --- CORE ANALYTICS LOGIC ---
const calculateAnalytics = (currentTrades) => {
  // This function performs all calculations. It's wrapped in useMemo for performance,
  // so it only re-runs when the 'trades' array changes.
  if (!currentTrades || currentTrades.length === 0) {
    return {
      totalCapital: INITIAL_CAPITAL, overallPnl: 0, currentEquity: INITIAL_CAPITAL, roi: 0,
      totalTrades: 0, winDays: 0, lossDays: 0, winRate: 0, lossRate: 0,
      avgProfitOnWinDays: 0, avgLossOnLossDays: 0, totalProfitOnWinDays: 0,
      totalLossOnLossDays: 0, maxProfit: 0, maxLoss: 0, maxWinningStreak: 0,
      maxLosingStreak: 0, maxDrawdown: 0, maxDDPercentage: 0, expectancy: 0,
      winLossRatio: 0, profitFactor: 0,
      pnlByDayOfWeek: DAY_NAME_MAPPING.map(day => ({ day, pnl: 0 })),
      monthlyPerformance: [], dailyPnlData: [], pnlDistribution: [],
    };
  }

  const calculatedTrades = currentTrades.map(trade => ({
    ...trade,
    netPnl: (parseFloat(trade.grossPnl) || 0) - (parseFloat(trade.taxesAndCharges) || 0),
  }));

  const winningTrades = calculatedTrades.filter(trade => trade.netPnl > 0);
  const losingTrades = calculatedTrades.filter(trade => trade.netPnl < 0);
  
  const totalTradesCount = calculatedTrades.length;
  const totalWinDays = winningTrades.length;
  const totalLossDays = losingTrades.length;
  
  const winRate = totalTradesCount > 0 ? (totalWinDays / totalTradesCount) * 100 : 0;
  
  const totalProfitOnWinDays = winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const totalLossOnLossDays = losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  
  const avgProfitOnWinDays = totalWinDays > 0 ? totalProfitOnWinDays / totalWinDays : 0;
  const avgLossOnLossDays = totalLossDays > 0 ? totalLossOnLossDays / totalLossDays : 0;
  
  const profitFactor = Math.abs(totalLossOnLossDays) > 0 ? Math.abs(totalProfitOnWinDays / totalLossOnLossDays) : 0;
  const expectancy = ((winRate / 100) * avgProfitOnWinDays) + (((100 - winRate) / 100) * avgLossOnLossDays);
  const winLossRatio = Math.abs(avgLossOnLossDays) > 0 ? Math.abs(avgProfitOnWinDays / avgLossOnLossDays) : 0;

  const sortedTrades = [...calculatedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));

  let cumulativePnl = 0;
  let peakEquity = INITIAL_CAPITAL;
  let maxDrawdownValue = 0;

  const dailyPnlData = sortedTrades.map(trade => {
    cumulativePnl += trade.netPnl;
    const currentEquityValue = INITIAL_CAPITAL + cumulativePnl;
    peakEquity = Math.max(peakEquity, currentEquityValue);
    const drawdown = peakEquity - currentEquityValue;
    maxDrawdownValue = Math.max(maxDrawdownValue, drawdown);
    return { date: trade.date, pnl: trade.netPnl, cumulativePnl };
  });

  const lastTrade = sortedTrades[sortedTrades.length - 1];
  const totalCapital = lastTrade?.capitalDeployed || INITIAL_CAPITAL;
  const totalNetPnl = cumulativePnl;
  const currentEquity = totalCapital + totalNetPnl;
  const roi = totalCapital > 0 ? (totalNetPnl / totalCapital) * 100 : 0;
  const maxDDPercentage = peakEquity > 0 ? (maxDrawdownValue / peakEquity) * 100 : 0;

    const maxProfit = winningTrades.length > 0 ? Math.max(...winningTrades.map(trade => trade.netPnl)) : 0;
    const maxLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(trade => trade.netPnl)) : 0;
    let currentWinStreak = 0, longestWinStreak = 0, currentLossStreak = 0, longestLossStreak = 0;
    sortedTrades.forEach(trade => {
      if (trade.netPnl > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
      } else if (trade.netPnl < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
      } else {
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    });
    const pnlByDayOfWeekMap = calculatedTrades.reduce((acc, trade) => {
      const dayName = new Date(trade.date).toLocaleDateString('en-US', { weekday: 'long' });
      acc[dayName] = (acc[dayName] || 0) + trade.netPnl;
      return acc;
    }, {});
    const pnlByDayOfWeek = DAY_NAME_MAPPING.map(day => ({ day: day.substring(0, 3), pnl: pnlByDayOfWeekMap[day] || 0 }));
    
    const monthlyData = calculatedTrades.reduce((acc, trade) => {
      const month = new Date(trade.date).toLocaleString('default', { month: 'short', year: 'numeric' });
      if (!acc[month]) {
        acc[month] = { netPnl: 0, capital: trade.capitalDeployed, date: new Date(trade.date) };
      }
      acc[month].netPnl += trade.netPnl;
      return acc;
    }, {});
    const monthlyPerformance = Object.keys(monthlyData)
      .map(month => ({
        month,
        netPnl: monthlyData[month].netPnl,
        capitalDeployed: monthlyData[month].capital,
        monthlyReturn: monthlyData[month].capital > 0 ? (monthlyData[month].netPnl / monthlyData[month].capital) * 100 : 0,
        date: monthlyData[month].date,
      }))
      .sort((a, b) => a.date - b.date);
      
    const pnlBuckets = [
      { range: '< -10k', min: -Infinity, max: -10000, count: 0, color: '#be123c' },
      { range: '-10k to -5k', min: -10000, max: -5000, count: 0, color: '#ef4444' },
      { range: '-5k to 0', min: -5000, max: -0.01, count: 0, color: '#f87171' },
      { range: '0 to 5k', min: 0, max: 5000, count: 0, color: '#a7f3d0' },
      { range: '5k to 10k', min: 5000, max: 10000, count: 0, color: '#34d399' },
      { range: '> 10k', min: 10000, max: Infinity, count: 0, color: '#059669' },
    ];
    calculatedTrades.forEach(trade => {
      const bucket = pnlBuckets.find(b => trade.netPnl >= b.min && trade.netPnl < b.max);
      if (bucket) bucket.count++;
    });

  return {
    totalCapital, overallPnl: totalNetPnl, currentEquity, roi, totalTrades: totalTradesCount,
    winDays: totalWinDays, lossDays: totalLossDays, winRate,
    avgProfitOnWinDays, avgLossOnLossDays, maxProfit, maxLoss,
    maxWinningStreak: longestWinStreak, maxLosingStreak: longestLossStreak,
    maxDrawdown: maxDrawdownValue, maxDDPercentage, expectancy, winLossRatio, profitFactor,
    pnlByDayOfWeek, monthlyPerformance, dailyPnlData,
    pnlDistribution: pnlBuckets.map(b => ({ name: b.range, trades: b.count, fill: b.color })),
  };
};

// --- MEMOIZED COMPONENTS ---
const MemoizedMetricCard = memo(({ title, value, colorClass = 'text-gray-200' }) => (
  <div className="bg-gray-800/50 p-4 rounded-lg text-center transition-all duration-300 ease-in-out hover:bg-gray-700/50 transform hover:scale-105 hover:shadow-lg hover:shadow-teal-500/20">
    <h3 className="text-sm text-gray-400 mb-1">{title}</h3>
    <p className={`text-xl lg:text-2xl font-bold ${colorClass}`}>{value}</p>
  </div>
));

// --- MAIN APP COMPONENT ---
const App = () => {
  // --- STATE MANAGEMENT ---
  const [trades, setTrades] = useState(() => generateSampleTrades(250));

  const [newTrade, setNewTrade] = useState(() => {
    const today = new Date();
    const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    return {
      date: todayLocal.toISOString().split('T')[0],
      day: DAY_NAME_MAPPING[today.getDay()],
      grossPnl: '', taxesAndCharges: '', capitalDeployed: INITIAL_CAPITAL,
    };
  });

  const [isLoading, setIsLoading] = useState(false);
  const [visibleTradeCount, setVisibleTradeCount] = useState(TRADES_PER_PAGE);
  const [modal, setModal] = useState({ isOpen: false, message: '', onConfirm: null });

  // --- DERIVED STATE & MEMOIZATION ---
  const summary = useMemo(() => calculateAnalytics(trades), [trades]);

  const sortedTradesForDisplay = useMemo(() => 
    [...trades].sort((a,b) => new Date(b.date) - new Date(a.date)),
  [trades]);

  // Calculate a dynamic interval for chart ticks to prevent clutter
  const tickInterval = useMemo(() => {
    if (!summary.dailyPnlData || summary.dailyPnlData.length < 2) return 'preserveEnd';
    // Aim for a reasonable number of ticks (e.g., 8-12) on the axis
    const desiredTicks = 10;
    return Math.max(1, Math.floor(summary.dailyPnlData.length / desiredTicks));
  }, [summary.dailyPnlData]);

  // --- EVENT HANDLERS ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let updatedTrade = { ...newTrade, [name]: value };
    if (name === 'date' && value) {
      const date = new Date(value);
      updatedTrade.day = DAY_NAME_MAPPING[date.getUTCDay()];
    }
    setNewTrade(updatedTrade);
  };

  const handleAddTrade = (e) => {
    e.preventDefault();
    setIsLoading(true);

    if (!newTrade.date || newTrade.grossPnl === '' || newTrade.taxesAndCharges === '' || newTrade.capitalDeployed === '') {
        setModal({ isOpen: true, message: 'Please fill out all required fields.', onConfirm: () => setModal({ isOpen: false }) });
        setIsLoading(false);
        return;
    }

    const tradeToAdd = {
        ...newTrade,
        id: `trade-${Date.now()}-${Math.random()}`,
        grossPnl: parseFloat(newTrade.grossPnl),
        taxesAndCharges: parseFloat(newTrade.taxesAndCharges),
        capitalDeployed: parseFloat(newTrade.capitalDeployed),
        day: new Date(newTrade.date).toLocaleDateString('en-US', { weekday: 'long' }),
    };

    setTrades(prevTrades => [...prevTrades, tradeToAdd]);
    
    const today = new Date();
    const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    setNewTrade({
        date: todayLocal.toISOString().split('T')[0],
        day: DAY_NAME_MAPPING[today.getDay()],
        grossPnl: '', taxesAndCharges: '',
        capitalDeployed: tradeToAdd.capitalDeployed,
    });
    
    setTimeout(() => setIsLoading(false), 300);
  };

  const handleDeleteTrade = (idToDelete) => {
    setModal({
      isOpen: true,
      message: 'Are you sure you want to delete this trade?',
      onConfirm: () => {
        setTrades(prevTrades => prevTrades.filter(trade => trade.id !== idToDelete));
        setModal({ isOpen: false });
      }
    });
  };

  const handleDeleteAllTrades = () => {
    if (trades.length === 0) {
      setModal({ isOpen: true, message: 'There are no trades to delete.', onConfirm: () => setModal({ isOpen: false }) });
      return;
    }
    setModal({
      isOpen: true,
      message: 'Are you sure you want to delete ALL trades? This action cannot be undone.',
      onConfirm: () => {
        setTrades([]);
        setVisibleTradeCount(TRADES_PER_PAGE);
        setModal({ isOpen: false });
      }
    });
  };
  
  const handleExportCSV = () => {
    if (trades.length === 0) {
      setModal({ isOpen: true, message: 'No trades to export.', onConfirm: () => setModal({ isOpen: false }) });
      return;
    }

    const headers = ['ID', 'Date', 'Day', 'Gross P&L', 'Taxes & Charges', 'Net P&L', 'Capital Deployed'];
    const csvContent = [
      headers.join(','),
      ...sortedTradesForDisplay.map(trade => { // Use sorted trades for export
        const netPnl = (parseFloat(trade.grossPnl) || 0) - (parseFloat(trade.taxesAndCharges) || 0);
        return [
          trade.id,
          trade.date,
          trade.day,
          trade.grossPnl,
          trade.taxesAndCharges,
          netPnl.toFixed(2),
          trade.capitalDeployed
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.href) {
      URL.revokeObjectURL(link.href);
    }
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'trade_journal_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-2 sm:p-4 font-sans antialiased">
        {modal.isOpen && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50">
                <div className="bg-gray-800 border border-teal-700 rounded-xl p-6 w-full max-w-sm text-center shadow-2xl">
                    <p className="text-lg mb-6">{modal.message}</p>
                    <div className="flex justify-center gap-4">
                        <button onClick={modal.onConfirm} className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition">Confirm</button>
                        {modal.onConfirm.toString() !== "() => setModal({ isOpen: false })" &&
                            <button onClick={() => setModal({ isOpen: false })} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700 transition">Cancel</button>
                        }
                    </div>
                </div>
            </div>
        )}

      <div className="container mx-auto max-w-7xl p-4 md:p-6 rounded-2xl shadow-[0_0_60px_-15px_rgba(0,255,255,0.2)] bg-gray-900 border border-teal-800/50">
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 pb-2">
            PRO TRADER JOURNAL
          </h1>
          <p className="text-teal-400/80 mt-2 text-sm md:text-base tracking-widest">
            BUILT BY PUJAN JAIN
          </p>
        </header>

        {/* --- Dashboard Metrics Grid --- */}
        <div className="mb-10">
            <h2 className="text-2xl font-bold text-teal-400 mb-4">Account Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MemoizedMetricCard title="Current Equity" value={formatCurrencyCompact(summary.currentEquity)} colorClass={(summary.currentEquity || 0) >= (summary.totalCapital || 0) ? 'text-green-400' : 'text-red-400'} />
                <MemoizedMetricCard title="Overall P&L" value={formatCurrencyCompact(summary.overallPnl)} colorClass={(summary.overallPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MemoizedMetricCard title="Return on Investment" value={formatPercentage(summary.roi)} colorClass={(summary.roi || 0) >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MemoizedMetricCard title="Initial Capital" value={formatCurrencyCompact(summary.totalCapital)} />
            </div>
        </div>
        
        <div className="mb-10">
            <h2 className="text-2xl font-bold text-teal-400 mb-4">Performance Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MemoizedMetricCard title="Win Rate" value={formatPercentage(summary.winRate)} colorClass="text-green-400" />
                <MemoizedMetricCard title="Profit Factor" value={(summary.profitFactor || 0).toFixed(2)} colorClass="text-cyan-400" />
                <MemoizedMetricCard title="Win/Loss Ratio" value={(summary.winLossRatio || 0).toFixed(2)} colorClass="text-cyan-400" />
                <MemoizedMetricCard title="Expectancy" value={formatCurrencyCompact(summary.expectancy)} colorClass={(summary.expectancy || 0) >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MemoizedMetricCard title="Avg. Win" value={formatCurrencyCompact(summary.avgProfitOnWinDays)} colorClass="text-green-400" />
                <MemoizedMetricCard title="Avg. Loss" value={formatCurrencyCompact(summary.avgLossOnLossDays)} colorClass="text-red-400" />
                <MemoizedMetricCard title="Total Trades" value={summary.totalTrades || 0} />
                <MemoizedMetricCard title="Winning Trades" value={summary.winDays || 0} colorClass="text-green-400" />
            </div>
        </div>

        <div className="mb-10">
            <h2 className="text-2xl font-bold text-teal-400 mb-4">Risk & Extremes</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MemoizedMetricCard title="Max Drawdown" value={formatPercentage(summary.maxDDPercentage)} colorClass="text-red-400" />
                <MemoizedMetricCard title="Max Drawdown (Abs)" value={formatCurrencyCompact(summary.maxDrawdown)} colorClass="text-red-400" />
                <MemoizedMetricCard title="Max Profit" value={formatCurrencyCompact(summary.maxProfit)} colorClass="text-green-400" />
                <MemoizedMetricCard title="Max Loss" value={formatCurrencyCompact(summary.maxLoss)} colorClass="text-red-400" />
                <MemoizedMetricCard title="Winning Streak" value={summary.maxWinningStreak || 0} colorClass="text-green-400" />
                <MemoizedMetricCard title="Losing Streak" value={summary.maxLosingStreak || 0} colorClass="text-red-400" />
                <MemoizedMetricCard title="Losing Trades" value={summary.lossDays || 0} colorClass="text-red-400" />
            </div>
        </div>


        {/* --- Charts Section --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96">
            <h2 className="text-xl font-bold text-teal-400 mb-4">Equity Curve</h2>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    fontSize={12} 
                    tick={{ fill: '#9ca3af', angle: -45, textAnchor: 'end' }} 
                    interval={tickInterval}
                    tickFormatter={formatDateForAxis}
                    height={50}
                />
                <YAxis dataKey="cumulativePnl" stroke="#9ca3af" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(INITIAL_CAPITAL + value)} tick={{ fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(INITIAL_CAPITAL + value), 'Equity']} />
                <Legend wrapperStyle={{ fontSize: '14px' }} />
                <Line type="monotone" dataKey="cumulativePnl" name="Equity" stroke="#2dd4bf" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 2, fill: '#2dd4bf' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96">
            <h2 className="text-xl font-bold text-teal-400 mb-4">Daily P&L</h2>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 20, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    fontSize={12} 
                    tick={{ fill: '#9ca3af', angle: -45, textAnchor: 'end' }} 
                    interval={tickInterval}
                    tickFormatter={formatDateForAxis}
                    height={50}
                />
                <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatCurrencyPrecise(value), 'Daily P&L']} cursor={{fill: 'rgba(148, 163, 184, 0.1)'}} />
                <Bar dataKey="pnl" name="Daily P&L">
                  {summary.dailyPnlData?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#34d399' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96">
            <h2 className="text-xl font-bold text-teal-400 mb-4">P&L by Day of Week</h2>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={summary.pnlByDayOfWeek} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} tick={{ fill: '#9ca3af' }} />
                  <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={formatCurrencyCompact} tick={{ fill: '#9ca3af' }} />
                  <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      itemStyle={{ color: '#e5e7eb' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value) => [formatCurrencyPrecise(value), 'Total P&L']}
                      cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                  />
                  <Bar dataKey="pnl" name="Total P&L">
                      {summary.pnlByDayOfWeek?.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#2dd4bf' : '#f43f5e'} />
                      ))}
                  </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96">
              <h2 className="text-xl font-bold text-teal-400 mb-4">P&L Distribution</h2>
              <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={summary.pnlDistribution} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tick={{ fill: '#9ca3af' }} />
                      <YAxis allowDecimals={false} stroke="#9ca3af" fontSize={12} label={{ value: 'No. of Trades', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 14 }} tick={{ fill: '#9ca3af' }} />
                      <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          itemStyle={{ color: '#e5e7eb' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value, name) => [value, 'Trades']}
                          cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <Bar dataKey="trades">
                          {summary.pnlDistribution?.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                      </Bar>
                  </BarChart>
              </ResponsiveContainer>
          </div>
        </div>

        {/* --- Trade Entry Form --- */}
        <div className="bg-gray-800/40 p-6 rounded-xl shadow-lg border border-gray-700/70 mb-10">
          <h2 className="text-2xl font-bold text-teal-400 mb-4">Add New Trade</h2>
          <form onSubmit={handleAddTrade} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
            <div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Date</label><input type="date" name="date" value={newTrade.date} onChange={handleInputChange} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required/></div>
            <div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Day</label><input type="text" name="day" value={newTrade.day} readOnly className="p-3 bg-gray-900/50 border border-gray-700 rounded-lg text-gray-400 cursor-not-allowed"/></div>
            <div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Gross P&L (₹)</label><input type="number" name="grossPnl" value={newTrade.grossPnl} onChange={handleInputChange} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition" placeholder="e.g., 5000" step="0.01" required/></div>
            <div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Charges (₹)</label><input type="number" name="taxesAndCharges" value={newTrade.taxesAndCharges} onChange={handleInputChange} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition" placeholder="e.g., 500" step="0.01" required/></div>
            <div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Capital (₹)</label><input type="number" name="capitalDeployed" value={newTrade.capitalDeployed} onChange={handleInputChange} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition" placeholder="e.g., 500000" step="1" required/></div>
            <button type="submit" disabled={isLoading} className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-teal-500 transition duration-300 transform hover:scale-105 disabled:bg-gray-500 disabled:cursor-not-allowed disabled:scale-100">{isLoading ? 'Adding...' : 'Add Trade'}</button>
          </form>
        </div>

        {/* --- Data Tables --- */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto">
                <h2 className="text-2xl font-bold text-teal-400 mb-4">Monthly Performance</h2>
                <table className="min-w-full"><thead className="border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase tracking-wider text-left"><th className="p-3 font-semibold">Month</th><th className="p-3 font-semibold">Net P&L</th><th className="p-3 font-semibold">Capital</th><th className="p-3 font-semibold">Return</th></tr></thead>
                    <tbody>
                        {summary.monthlyPerformance?.length > 0 ? summary.monthlyPerformance.map(m => (
                            <tr key={m.month} className="border-b border-gray-700/50 hover:bg-gray-800/60 transition-colors"><td className="p-3 whitespace-nowrap">{m.month}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.netPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyCompact(m.netPnl)}</td><td className="p-3 whitespace-nowrap text-gray-300">{formatCurrencyCompact(m.capitalDeployed)}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.monthlyReturn || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercentage(m.monthlyReturn)}</td></tr>
                        )) : (<tr><td colSpan="4" className="p-8 text-center text-gray-400">No monthly data to display.</td></tr>)}
                    </tbody>
                </table>
            </div>

            <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto">
                <div className="flex justify-between items-center mb-4 gap-2">
                    <h2 className="text-2xl font-bold text-teal-400">Trade History</h2>
                    <div className="flex gap-2">
                      <button 
                        onClick={handleDeleteAllTrades}
                        className="px-3 py-2 bg-red-600/80 text-white font-bold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500 transition duration-300 transform hover:scale-105 flex items-center gap-2"
                        aria-label="Delete All Trades"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <button 
                        onClick={handleExportCSV} 
                        className="px-4 py-2 bg-teal-500/80 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-teal-500 transition duration-300 transform hover:scale-105 flex items-center gap-2"
                        aria-label="Export to CSV"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        <span className="hidden sm:inline">Export CSV</span>
                      </button>
                    </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                    <table className="min-w-full"><thead className="sticky top-0 bg-gray-800/95 backdrop-blur-sm border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase tracking-wider text-left"><th className="p-3 font-semibold">Date</th><th className="p-3 font-semibold">Net P&L</th><th className="p-3 font-semibold text-right">Actions</th></tr></thead>
                        <tbody>
                            {sortedTradesForDisplay.slice(0, visibleTradeCount).map(trade => {
                                const netPnl = (trade.grossPnl || 0) - (trade.taxesAndCharges || 0);
                                return (
                                    <tr key={trade.id} className="border-b border-gray-700/50 hover:bg-gray-800/60 transition-colors">
                                        <td className="p-3 whitespace-nowrap">{trade.date}</td>
                                        <td className={`p-3 whitespace-nowrap font-semibold ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyPrecise(netPnl)}</td>
                                        <td className="p-3 whitespace-nowrap text-right">
                                            <button onClick={() => handleDeleteTrade(trade.id)} className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-500 hover:text-white text-xs font-bold rounded-md transition duration-300">DELETE</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {visibleTradeCount < trades.length && (
                    <div className="mt-4 text-center">
                        <button onClick={() => setVisibleTradeCount(prev => prev + TRADES_PER_PAGE)} className="text-teal-400 hover:text-teal-300 font-semibold">
                            Load More
                        </button>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
