import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection, getDocs, deleteDoc } from "firebase/firestore";


// --- CONSTANTS & CONFIG ---
const DAY_NAME_MAPPING = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TRADES_PER_PAGE = 20;
const SESSION_KEY = 'proTraderAccessCode';
const DB_COLLECTION_NAME = 'pro_trader_journals';
const COUPONS_COLLECTION_NAME = 'coupons';
const USER_TAGS = ['New User', 'Test User', 'Beta User', 'Good User', 'Demo User'];


// --- USER-PROVIDED CREDENTIALS ---
const ADMIN_PASSWORD = 'Pujan@123';
const RAZORPAY_KEY_ID = 'rzp_live_pWNLoIsX4fvAzA';
const APP_ID = 'pro-trader-journall';
const INITIAL_AUTH_TOKEN = 'jfdkjfdjijfeayuioptwreqandfkdjfdhuahdfasytadfnvnaeqwoajenvbajytaadjioe';

const firebaseConfig = {
    apiKey: "AIzaSyB9xvaaiOu72Q3CvVpQUOHds8xig54-ljw",
    authDomain: "pro-trader-journall.firebaseapp.com",
    projectId: "pro-trader-journall",
    storageBucket: "pro-trader-journall.firebasestorage.app",
    messagingSenderId: "711459341427",
    appId: "1:711459341427:web:cf64e7052e9138bb76d606"
};
const appId = APP_ID;


// --- HELPER FUNCTIONS ---
const formatCurrencyPrecise = (value) => `₹${(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatCurrencyCompact = (value) => {
    const num = Number(value) || 0;
    const sign = num < 0 ? "-" : "";
    const absNum = Math.abs(num);

    if (absNum >= 10000000) { // 1 Crore+
        return `${sign}₹${(absNum / 10000000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}Cr`;
    }
    if (absNum >= 100000) { // 1 Lakh+
        return `${sign}₹${(absNum / 100000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}L`;
    }
    // Below 1 Lakh
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const formatPercentage = (value) => `${(value || 0).toFixed(2)}%`;
const formatDateForAxis = (tickItem) => {
    const date = new Date(tickItem);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
};
const generateUniqueId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// --- SAMPLE DATA GENERATION ---
const generateSampleTrades = (count, initialCapital) => {
    const trades = [];
    let currentDate = new Date();
    currentDate.setMonth(currentDate.getMonth() - 6); // Start 6 months ago
    let currentCapital = initialCapital;

    for (let i = 0; i < count; i++) {
        currentDate.setDate(currentDate.getDate() + 1);
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) { i--; continue; }

        if (i > 0 && Math.random() < 0.05) {
            if (Math.random() > 0.5) {
                currentCapital += Math.random() * (initialCapital * 0.1);
            } else {
                currentCapital -= Math.random() * (initialCapital * 0.05);
            }
        }

        const isProfit = Math.random() > 0.45;
        const pnlPercentage = isProfit ? Math.random() * 0.04 : Math.random() * 0.025;
        const pnlMagnitude = currentCapital * pnlPercentage;
        const grossPnl = isProfit ? pnlMagnitude : -pnlMagnitude;
        const taxesAndCharges = Math.abs(grossPnl) * (Math.random() * 0.05 + 0.02);
        
        trades.push({
            id: generateUniqueId(),
            date: currentDate.toISOString().split('T')[0],
            day: DAY_NAME_MAPPING[currentDate.getDay()],
            grossPnl: parseFloat(grossPnl.toFixed(2)),
            taxesAndCharges: parseFloat(taxesAndCharges.toFixed(2)),
            capitalDeployed: parseFloat(currentCapital.toFixed(2)),
            notes: isProfit ? 'Good entry based on trend.' : 'Stopped out, risk managed.',
            tags: []
        });
    }
    return trades;
};


// --- CORE ANALYTICS LOGIC (FULLY AUDITED) ---
const calculateAnalytics = (currentTrades, journalInitialCapital = 0) => {
  // Return a default state if there are no trades to analyze.
  if (!currentTrades || currentTrades.length === 0) {
    return {
      startingCapital: journalInitialCapital, averageCapital: journalInitialCapital, overallPnl: 0, currentEquity: journalInitialCapital, roi: 0,
      totalTrades: 0, winDays: 0, lossDays: 0, winRate: 0, avgProfitOnWinDays: 0, avgLossOnLossDays: 0,
      maxProfit: 0, maxLoss: 0, maxWinningStreak: 0, maxLosingStreak: 0, maxDrawdown: 0, maxDDPercentage: 0,
      expectancy: 0, winLossRatio: 0, profitFactor: 0,
      pnlByDayOfWeek: DAY_NAME_MAPPING.map(day => ({ day: day.substring(0,3), pnl: 0 })),
      monthlyPerformance: [], dailyPnlData: [], pnlDistribution: [],
    };
  }

  // Sort trades by date to ensure chronological calculations.
  const sortedTrades = [...currentTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
  const calculatedTrades = sortedTrades.map(trade => ({
    ...trade,
    netPnl: (trade.grossPnl || 0) - (trade.taxesAndCharges || 0),
    capitalDeployed: parseFloat(trade.capitalDeployed) || 0
  }));

  // --- Basic Performance Metrics ---
  const winningTrades = calculatedTrades.filter(t => t.netPnl > 0);
  const losingTrades = calculatedTrades.filter(t => t.netPnl < 0);
  const totalTradesCount = calculatedTrades.length;
  const totalWinDays = winningTrades.length;
  const totalLossDays = losingTrades.length;
  const winRate = totalTradesCount > 0 ? (totalWinDays / totalTradesCount) * 100 : 0;
  
  const totalProfitOnWinDays = winningTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const totalLossOnLossDays = losingTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const totalNetPnl = totalProfitOnWinDays + totalLossOnLossDays;

  const avgProfitOnWinDays = totalWinDays > 0 ? totalProfitOnWinDays / totalWinDays : 0;
  const avgLossOnLossDays = totalLossDays > 0 ? totalLossOnLossDays / totalLossDays : 0;
  
  // --- Key Trading Ratios ---
  const profitFactor = Math.abs(totalLossOnLossDays) > 0 ? Math.abs(totalProfitOnWinDays / totalLossOnLossDays) : 0;
  const expectancy = totalTradesCount > 0 ? totalNetPnl / totalTradesCount : 0;
  const winLossRatio = Math.abs(avgLossOnLossDays) > 0 ? Math.abs(avgProfitOnWinDays / avgLossOnLossDays) : 0;
  
  const maxProfit = Math.max(0, ...winningTrades.map(t => t.netPnl));
  const maxLoss = Math.min(0, ...losingTrades.map(t => t.netPnl));

  // --- Streaks Calculation ---
  let currentWinStreak = 0, longestWinStreak = 0, currentLossStreak = 0, longestLossStreak = 0;
  calculatedTrades.forEach(trade => {
    if (trade.netPnl > 0) { currentWinStreak++; currentLossStreak = 0; }
    else if (trade.netPnl < 0) { currentLossStreak++; currentWinStreak = 0; }
    longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
  });

  // --- Equity Curve, Drawdown, and Capital Flow Calculation (Audited for correctness) ---
  const dailyPnlData = [];
  let runningEquity = journalInitialCapital;
  let peakEquity = journalInitialCapital;
  let maxDrawdownValue = 0;
  
  for (let i = 0; i < calculatedTrades.length; i++) {
      const currentTrade = calculatedTrades[i];
      // Correctly account for capital changes between days.
      const prevCapital = (i === 0) ? journalInitialCapital : calculatedTrades[i-1].capitalDeployed;
      const prevEquity = (i === 0) ? journalInitialCapital : dailyPnlData[i-1].equity;
      const capitalFlow = currentTrade.capitalDeployed - prevCapital;
      
      // Equity at the start of the day is the previous day's equity plus any new capital.
      const equityStartOfDay = prevEquity + capitalFlow;
      runningEquity = equityStartOfDay + currentTrade.netPnl;
      
      // Peak equity is the highest point the equity has reached so far.
      // This logic correctly handles initial losses by keeping the peak at the starting capital until a new high is made.
      peakEquity = Math.max(peakEquity, equityStartOfDay, runningEquity);
      const drawdown = peakEquity - runningEquity;
      maxDrawdownValue = Math.max(maxDrawdownValue, drawdown);
      
      dailyPnlData.push({ date: currentTrade.date, pnl: currentTrade.netPnl, equity: runningEquity, capital: currentTrade.capitalDeployed, drawdown: -drawdown, capitalFlow: capitalFlow });
  }

  const currentEquity = calculatedTrades.length > 0 ? runningEquity : journalInitialCapital;
  const maxDDPercentage = peakEquity > 0 ? (maxDrawdownValue / peakEquity) * 100 : 0;
  const startingCapital = journalInitialCapital;
  const averageCapital = calculatedTrades.length > 0 ? calculatedTrades.reduce((sum, t) => sum + t.capitalDeployed, 0) / calculatedTrades.length : journalInitialCapital;
  const roi = averageCapital > 0 ? (totalNetPnl / averageCapital) * 100 : 0;

  // --- P&L by Day of Week ---
  const pnlByDayOfWeekMap = calculatedTrades.reduce((acc, t) => {
    const dayName = DAY_NAME_MAPPING[new Date(t.date).getUTCDay()];
    acc[dayName] = (acc[dayName] || 0) + t.netPnl; return acc; }, {});
  const pnlByDayOfWeek = DAY_NAME_MAPPING.map(day => ({ day: day.substring(0, 3), pnl: pnlByDayOfWeekMap[day] || 0 }));
  
  // --- Monthly Performance ---
  const monthlyData = calculatedTrades.reduce((acc, trade) => {
    const month = new Date(trade.date).toLocaleString('default', { month: 'short', year: 'numeric' });
    if (!acc[month]) acc[month] = { netPnl: 0, capitals: [], date: new Date(trade.date) };
    acc[month].netPnl += trade.netPnl;
    acc[month].capitals.push(trade.capitalDeployed);
    return acc;
  }, {});

  const monthlyPerformance = Object.keys(monthlyData).map(month => {
      const monthInfo = monthlyData[month];
      const avgCapitalForMonth = monthInfo.capitals.reduce((a, b) => a + b, 0) / monthInfo.capitals.length;
      const monthlyReturn = avgCapitalForMonth > 0 ? (monthInfo.netPnl / avgCapitalForMonth) * 100 : 0;
      return { month, netPnl: monthInfo.netPnl, capitalDeployed: avgCapitalForMonth, monthlyReturn, date: monthInfo.date };
    }).sort((a, b) => a.date - b.date);
    
  // --- P&L Distribution Histogram Buckets ---
  const pnlPercentageBuckets = [
    { name: '< -3.5%', min: -Infinity, max: -3.5, trades: 0, fill: '#7f1d1d' },
    { name: '-3.5% to -2.5%', min: -3.5, max: -2.5, trades: 0, fill: '#b91c1c' },
    { name: '-2.5% to -1.5%', min: -2.5, max: -1.5, trades: 0, fill: '#dc2626' },
    { name: '-1.5% to -1%', min: -1.5, max: -1, trades: 0, fill: '#ef4444' },
    { name: '-1% to 0%', min: -1, max: -0.0001, trades: 0, fill: '#f87171' },
    { name: '0% to 1%', min: 0, max: 1, trades: 0, fill: '#a7f3d0' },
    { name: '1% to 1.5%', min: 1, max: 1.5, trades: 0, fill: '#4ade80' },
    { name: '1.5% to 2.5%', min: 1.5, max: 2.5, trades: 0, fill: '#22c55e' },
    { name: '2.5% to 3.5%', min: 2.5, max: 3.5, trades: 0, fill: '#16a34a' },
    { name: '> 3.5%', min: 3.5, max: Infinity, trades: 0, fill: '#15803d' },
  ];

  calculatedTrades.forEach(trade => {
    if (trade.capitalDeployed > 0) {
      const pnlPercent = (trade.netPnl / trade.capitalDeployed) * 100;
      const bucket = pnlPercentageBuckets.find(b => pnlPercent >= b.min && pnlPercent < b.max);
      if (bucket) {
        bucket.trades++;
      }
    }
  });

  // --- Final Return Object ---
  return {
    startingCapital, averageCapital, overallPnl: totalNetPnl, currentEquity, roi, totalTrades: totalTradesCount,
    winDays: totalWinDays, lossDays: totalLossDays, winRate, avgProfitOnWinDays, avgLossOnLossDays, maxProfit, maxLoss,
    maxWinningStreak: longestWinStreak, maxLosingStreak: longestLossStreak, maxDrawdown: maxDrawdownValue,
    maxDDPercentage, expectancy, winLossRatio, profitFactor, pnlByDayOfWeek, monthlyPerformance, dailyPnlData,
    pnlDistribution: pnlPercentageBuckets,
  };
};


// --- UI COMPONENTS ---
const MemoizedMetricCard = memo(({ title, value, colorClass = 'text-gray-200', delay, isVisible }) => (
  <div 
    className={`
      bg-gray-800/50 p-4 rounded-lg text-center transform transition-all duration-150 
      ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      hover:bg-gray-700/50 hover:-translate-y-1.5 hover:scale-105 hover:shadow-xl hover:shadow-teal-500/20
    `}
    style={{ transitionDelay: `${delay * 40}ms` }}
  >
    <h3 className="text-sm text-gray-400 mb-1">{title}</h3>
    <p className={`text-xl lg:text-2xl font-bold ${colorClass}`}>{value}</p>
  </div>
));

const BackButton = ({ onClick }) => (
    <button onClick={onClick} className="absolute top-4 left-4 z-20 p-2 bg-gray-800/50 rounded-full text-teal-400 hover:bg-gray-700/50 transition-all transform hover:scale-110">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
    </button>
);

const LandingPage = ({ setView }) => {
    const Icon = memo(({ path, className = "h-8 w-8" }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>);

    const allFeatures = useMemo(() => [
        { icon: <Icon path="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>, title: 'Track Your Bottom Line' },
        { icon: <Icon path="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>, title: 'Visualize Your Growth' },
        { icon: <Icon path="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/>, title: 'Measure Capital Efficiency' },
        { icon: <Icon path="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7l-4.5 4.5L13 8l-4.5 4.5L3 7z"/>, title: 'Know Your Win Rate' },
        { icon: <Icon path="M4.874 15.126a5.002 5.002 0 010-6.252M19.126 15.126a5.002 5.002 0 000-6.252"/>, title: 'Gauge Strategy Health' },
        { icon: <Icon path="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/>, title: 'Understand Your Risk' },
        { icon: <Icon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>, title: 'Discover Hidden Patterns' },
        { icon: <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>, title: 'Connect Mindset to Results' },
        { icon: <Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>, title: 'Own Your Data' },
    ], []);

    const sampleData = useMemo(() => {
        const initialCapital = 1000000;
        const sampleJournal = { id: 'preview_journal', name: 'Preview Strategy', initialCapital: initialCapital };
        const trades = generateSampleTrades(125, initialCapital);
        return {
            userInfo: { name: 'Demo User', plan: 'pro', expiryDate: new Date().getTime() + 365 * 24 * 60 * 60 * 1000 },
            journals: [sampleJournal],
            trades: { 'preview_journal': trades }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-sans overflow-x-hidden">
            <div className="absolute inset-0 -z-10 h-full w-full bg-gray-950 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>

            <header className="absolute top-0 left-0 right-0 z-20 p-4">
                <div className="container mx-auto flex flex-wrap justify-between items-center gap-4">
                    <h1 className="text-xl font-bold text-teal-400 tracking-wider">PRO TRADER JOURNAL</h1>
                    <div className="space-x-2">
                        <button onClick={() => setView('login')} className="px-4 py-2 text-teal-300 font-semibold rounded-lg hover:bg-gray-800/50 transition-colors">Login</button>
                        <button onClick={() => setView('userDetails')} className="px-4 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all transform hover:scale-105">Sign Up</button>
                    </div>
                </div>
            </header>

            <main className="container mx-auto flex flex-col justify-center items-center min-h-screen text-center px-4 pt-20 pb-10">
                <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-500 tracking-tight leading-tight pb-2">
                    Achieve Trading Mastery
                </h2>
                <div className="flex flex-col sm:flex-row items-center justify-center text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mt-2">
                    <span className="text-gray-300 mr-3">Through</span>
                    <div className="h-12 md:h-14 overflow-hidden">
                         <ul className="animate-scroll-up">
                            <li className="text-teal-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Data-Driven Insights.</li>
                            <li className="text-cyan-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Disciplined Execution.</li>
                            <li className="text-emerald-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Performance Analysis.</li>
                            <li className="text-violet-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Systematic Risk-Taking.</li>
                            <li className="text-rose-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Strategic Refinement.</li>
                            <li className="text-teal-400 h-12 md:h-14 flex items-center justify-center sm:justify-start">Data-Driven Insights.</li>
                        </ul>
                    </div>
                </div>
                <p className="mt-6 max-w-2xl text-lg text-gray-400">
                    Stop guessing. Start analyzing. The ultimate journal for serious traders who want to find their edge, manage risk, and build lasting consistency.
                </p>
                <button onClick={() => setView('userDetails')} className="mt-10 px-8 py-4 bg-gradient-to-r from-teal-400 to-cyan-500 text-white font-bold rounded-xl hover:opacity-90 transition-opacity duration-300 text-lg shadow-lg shadow-teal-500/30 transform hover:scale-105">
                    Start Your 1-Month Trial for ₹99
                </button>
            </main>

            <section className="py-12 bg-gray-950/50 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-gray-950 via-transparent to-gray-950 z-10"></div>
                <div className="flex animate-ticker">
                    {[...allFeatures, ...allFeatures].map((feature, index) => (
                        <div key={index} className="flex-shrink-0 flex items-center space-x-4 mx-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                            <div className="text-teal-400">{feature.icon}</div>
                            <span className="text-lg font-semibold text-white whitespace-nowrap">{feature.title}</span>
                        </div>
                    ))}
                </div>
            </section>
            
            <section className="py-20">
                <div className="container mx-auto px-4 text-center">
                    <h2 className="text-3xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-4">A Sneak Peek of the Dashboard</h2>
                    <p className="max-w-3xl mx-auto text-lg text-gray-400 mb-12">This is the command center for your trading. All your data, beautifully visualized.</p>
                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-3xl blur-lg opacity-50 group-hover:opacity-75 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                        <div className="relative w-full overflow-x-auto">
                             <Dashboard
                                allData={sampleData}
                                isPreview={true}
                                setModal={() => {}}
                                updateData={() => {}}
                                userId="preview_user"
                                onLogout={() => {}}
                                setView={() => {}}
                                modal={{ isOpen: false }}
                            />
                        </div>
                    </div>
                </div>
            </section>


            <footer className="py-8">
                <div className="container mx-auto text-center text-gray-500">
                    <p>&copy; {new Date().getFullYear()} Pro Trader Journal. All Rights Reserved.</p>
                    <button onClick={() => setView('admin')} className="text-xs text-gray-700 hover:text-gray-500 mt-2">Admin Panel</button>
                </div>
            </footer>
        </div>
    );
};

const LoginScreen = ({ onLogin, setModal, setView, db }) => {
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!code || !password) {
            setModal({ isOpen: true, type: 'alert', message: 'Please enter an access code and password.' });
            return;
        }
        setIsLoading(true);
        try {
            await onLogin(code, password);
        } catch (error) {
            // Errors are handled within onLogin, but this catch prevents unhandled promise rejections
            console.error("Login attempt failed:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans">
             <div className="absolute inset-0 -z-10 h-full w-full bg-gray-950 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
            <div className="w-full max-w-md">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">Welcome Back</h1>
                    <p className="text-gray-400 mt-2">Login to access your journal.</p>
                </header>
                <div className="bg-gray-900/50 backdrop-blur-sm border border-teal-800/50 rounded-2xl shadow-2xl p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" placeholder="Access Code" value={code} onChange={(e) => setCode(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <button type="submit" disabled={isLoading} className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all transform hover:scale-105 disabled:bg-gray-500 disabled:scale-100">
                            {isLoading ? <span className="animate-pulse">Verifying...</span> : 'Login'}
                        </button>
                    </form>
                    <p className="text-center text-gray-400 mt-6">
                        Don't have an account?{' '}
                        <button onClick={() => setView('userDetails')} className="font-semibold text-teal-400 hover:text-teal-300 transition-colors">
                            Register Here
                        </button>
                    </p>
                     <p className="text-center text-gray-500 mt-4 text-sm">
                        <button onClick={() => setView('landing')} className="hover:text-gray-300 transition-colors">
                            &larr; Back to Home
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

const UserDetailsScreen = ({ setView, setRegistrationDetails, goBack }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [mobile, setMobile] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setRegistrationDetails(prev => ({ ...prev, name, email, mobile }));
        setView('register');
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans relative">
            <BackButton onClick={goBack} />
            <div className="w-full max-w-md">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">Let's Get Started</h1>
                    <p className="text-gray-400 mt-2">Tell us a bit about yourself.</p>
                </header>
                <div className="bg-gray-900 border border-teal-800/50 rounded-2xl shadow-2xl p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <input type="tel" placeholder="Mobile Number" value={mobile} onChange={e => setMobile(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <button type="submit" className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all transform hover:scale-105">
                            Next: Secure Your Account
                        </button>
                    </form>
                    <p className="text-center text-gray-500 mt-4 text-sm">
                        <button onClick={() => setView('landing')} className="hover:text-gray-300 transition-colors">
                            &larr; Back to Home
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};


const RegisterScreen = ({ setView, setRegistrationDetails, db, setModal, goBack }) => {
    const [accessCode, setAccessCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (password !== confirmPassword) {
            setModal({ isOpen: true, type: 'alert', message: 'Passwords do not match.' });
            return;
        }

        setIsLoading(true);

        if (!db) {
            setModal({ isOpen: true, type: 'alert', message: 'Database connection not available. Please contact support.' });
            setIsLoading(false);
            return;
        }

        const trimmedCode = accessCode.trim();

        if (!/^\d{5,10}$/.test(trimmedCode)) {
            setModal({ isOpen: true, type: 'alert', message: 'Access Code must be 5 to 10 digits.' });
            setIsLoading(false);
            return;
        }

        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, trimmedCode);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                setModal({ isOpen: true, type: 'alert', message: 'This access code is already taken. Please choose another one.' });
            } else {
                setRegistrationDetails(prev => ({ ...prev, accessCode: trimmedCode, password: password }));
                setView('plans');
            }
        } catch (error) {
            console.error("Error checking access code:", error);
            setModal({ isOpen: true, type: 'alert', message: 'An error occurred. Please try again.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans relative">
            <BackButton onClick={goBack} />
            <div className="w-full max-w-md">
                 <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">Secure Your Account</h1>
                    <p className="text-gray-400 mt-2">Create a PIN and password for your journal.</p>
                </header>
                <div className="bg-gray-900 border border-teal-800/50 rounded-2xl shadow-2xl p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="tel" pattern="\d{5,10}" title="Access Code must be 5 to 10 digits." placeholder="Create a Secure 5-10 Digit PIN" value={accessCode} onChange={e => setAccessCode(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required />
                        <button type="submit" disabled={isLoading} className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all transform hover:scale-105 disabled:bg-gray-500 disabled:scale-100">
                            {isLoading ? <span className="animate-pulse">Checking...</span> : 'Proceed to Plans'}
                        </button>
                    </form>
                     <p className="text-center text-gray-400 mt-6">
                        Already have an account?{' '}
                        <button onClick={() => setView('login')} className="font-semibold text-teal-400 hover:text-teal-300 transition-colors">
                            Login
                        </button>
                    </p>
                    <p className="text-center text-gray-500 mt-4 text-sm">
                        <button onClick={() => setView('landing')} className="hover:text-gray-300 transition-colors">
                            &larr; Back to Home
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

const PlansScreen = ({ onPlanSelect, setModal, goBack, db, isProcessingPayment }) => {
    const [showPreview, setShowPreview] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [discountedPrices, setDiscountedPrices] = useState({ monthly: 9900, yearly: 49900 });

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) {
            setModal({ isOpen: true, type: 'alert', message: 'Please enter a coupon code.' });
            return;
        }
        try {
            const couponRef = doc(db, 'artifacts', appId, 'public', 'data', COUPONS_COLLECTION_NAME, couponCode.trim().toUpperCase());
            const couponSnap = await getDoc(couponRef);
            if (couponSnap.exists()) {
                const couponData = couponSnap.data();
                if (couponData.isActive) {
                    setAppliedCoupon(couponData);
                    const discount = couponData.discountPercentage / 100;
                    setDiscountedPrices({
                        monthly: Math.round(9900 * (1 - discount)),
                        yearly: Math.round(49900 * (1 - discount)),
                    });
                    setModal({ isOpen: true, type: 'alert', message: `Coupon applied! ${couponData.discountPercentage}% off.` });
                } else {
                    setModal({ isOpen: true, type: 'alert', message: 'This coupon is no longer active.' });
                }
            } else {
                setModal({ isOpen: true, type: 'alert', message: 'Invalid coupon code.' });
            }
        } catch (error) {
            console.error("Error applying coupon:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Could not apply coupon. Please try again.' });
        }
    };

    const sampleData = useMemo(() => {
        const initialCapital = 1000000;
        const sampleJournal = { id: 'preview_journal', name: 'Preview Strategy', initialCapital: initialCapital };
        const trades = generateSampleTrades(125, initialCapital);
        return {
            userInfo: { name: 'Demo User', plan: 'pro', expiryDate: new Date().getTime() + 365 * 24 * 60 * 60 * 1000 },
            journals: [sampleJournal],
            trades: { 'preview_journal': trades }
        };
    }, []);

    const Icon = memo(({ path }) => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>);

    const featureSections = {
        "Core Account Metrics": [
            { icon: <Icon path="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />, title: 'Overall P&L', description: 'Your total net profit or loss across all trades.' },
            { icon: <Icon path="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />, title: 'Current Equity', description: 'The real-time value of your trading account.' },
            { icon: <Icon path="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />, title: 'Return on Investment (ROI)', description: 'The percentage return on your average deployed capital.' },
            { icon: <Icon path="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2" />, title: 'Average Capital', description: 'The average amount of capital used per trading day.' },
        ],
        "Performance & Risk Ratios": [
            { icon: <Icon path="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7l-4.5 4.5L13 8l-4.5 4.5L3 7z" />, title: 'Win Rate', description: 'The percentage of profitable days.' },
            { icon: <Icon path="M4.874 15.126a5.002 5.002 0 010-6.252M19.126 15.126a5.002 5.002 0 000-6.252" />, title: 'Profit Factor', description: 'Gross profit divided by gross loss. A key health metric.' },
            { icon: <Icon path="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01" />, title: 'Win/Loss Ratio', description: 'The size of your average win versus your average loss.' },
            { icon: <Icon path="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.085a2 2 0 00-1.736.97l-1.9 3.8z" />, title: 'Expectancy', description: 'The average amount you expect to win or lose per trade.' },
            { icon: <Icon path="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />, title: 'Max Drawdown (%)', description: 'The largest peak-to-trough drop in your equity.' },
            { icon: <Icon path="M15 13l-3-3m0 0l-3 3m3-3v12" />, title: 'Max Drawdown (₹)', description: 'The absolute value of your largest equity drop.' },
        ],
        "Behavioral Analytics": [
            { icon: <Icon path="M7 11l5-5m0 0l5 5m-5-5v12" />, title: 'Max Winning Streak', description: 'The highest number of consecutive profitable days.' },
            { icon: <Icon path="M7 13l5 5m0 0l5-5m-5 5V6" />, title: 'Max Losing Streak', description: 'The highest number of consecutive losing days.' },
        ],
        "Advanced Visualizations": [
            { icon: <Icon path="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2z" />, title: 'Interactive Equity Curve', description: 'Visually track your account growth over time.' },
            { icon: <Icon path="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />, title: 'Drawdown "Underwater" Curve', description: 'Analyze the depth and duration of your drawdowns.' },
            { icon: <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />, title: 'Daily P&L Bar Chart', description: 'See the daily fluctuations of your profit and loss.' },
            { icon: <Icon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />, title: 'P&L by Day of Week', description: 'Discover which days you perform best on.' },
            { icon: <Icon path="M7 16V4m0 12L4 13m3 3l3-3m-3 3H4m3 3h3m-3-3l-3 3m3-3V4m0 12h3m0 0l3-3m-3 3l-3-3m3 3h3m0 0V4m0 12h3m0 0l3-3m-3 3l-3-3" />, title: 'P&L Distribution Histogram', description: 'Understand the magnitude of your wins and losses.' },
            { icon: <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" />, title: '6-Month Performance Heatmap', description: 'A calendar view to easily spot patterns and consistency.' },
        ],
        "Journaling & Utility": [
            { icon: <Icon path="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />, title: 'Unlimited Journals', description: 'Create separate journals for different strategies or accounts.' },
            { icon: <Icon path="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />, title: 'Secure Cloud Sync', description: 'Your data is encrypted, backed up, and synced in real-time.' },
            { icon: <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />, title: 'Detailed Note-Taking', description: 'Log your thoughts, strategy, and mindset for each day.' },
            { icon: <Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />, title: 'Export to CSV', description: 'Your data is always yours. Export for offline analysis.' },
        ]
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-sans p-4 sm:p-6 lg:p-8 overflow-x-hidden relative">
            {isProcessingPayment && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex flex-col justify-center items-center z-50">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-teal-400"></div>
                    <p className="text-white text-xl mt-4">Processing Payment...</p>
                </div>
            )}
            <BackButton onClick={goBack} />
            <style>{`
                .bg-grid {
                    background-image: linear-gradient(to right, rgba(20, 184, 166, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(20, 184, 166, 0.1) 1px, transparent 1px);
                    background-size: 3rem 3rem;
                }
                .card-glow { position: relative; }
                .card-glow::before {
                    content: ''; position: absolute; left: 0; top: 0; width: 100%; height: 100%;
                    background: radial-gradient(800px circle at var(--mouse-x) var(--mouse-y), rgba(20, 184, 166, 0.2), transparent 40%);
                    border-radius: inherit; opacity: 0; transition: opacity 0.5s;
                }
                .card-glow:hover::before { opacity: 1; }
            `}</style>
            <div className="absolute inset-0 -z-10 h-full w-full bg-gray-950 bg-grid"></div>
            <div className="w-full max-w-7xl mx-auto">
                <header className="text-center my-12 md:my-16">
                    <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400 tracking-tight">The Professional's Toolkit for</h1>
                     <div className="flex flex-col sm:flex-row items-center justify-center text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mt-2">
                        <div className="h-12 md:h-16 overflow-hidden">
                            <ul className="animate-scroll-up leading-tight">
                                <li className="text-teal-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Data-Driven</li>
                                <li className="text-cyan-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Disciplined</li>
                                <li className="text-emerald-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Performance</li>
                                <li className="text-violet-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Systematic</li>
                                <li className="text-rose-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Strategic</li>
                                <li className="text-teal-400 h-12 md:h-16 flex items-center justify-center sm:justify-end">Data-Driven</li>
                            </ul>
                        </div>
                        <span className="ml-0 sm:ml-3 text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400">Trading.</span>
                    </div>
                </header>

                <div className="flex flex-col md:flex-row items-stretch justify-center gap-8 my-16">
                    <div className="w-full max-w-sm bg-gray-900/50 backdrop-blur-sm border border-teal-800/50 rounded-2xl p-8 text-center transition-all duration-300 hover:border-teal-500/70 hover:shadow-2xl hover:shadow-teal-500/10 transform hover:-translate-y-2 flex flex-col relative">
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white font-bold px-4 py-1 rounded-full text-sm animate-pulse">
                            LIMITED TIME OFFER
                        </div>
                        <div className="flex-grow">
                            <h3 className="text-2xl font-bold text-gray-300">Pro Monthly</h3>
                            <p className="mt-2 text-gray-400">Flexible monthly access</p>
                            <div className="my-8">
                                <p className="text-5xl font-extrabold text-white">₹{discountedPrices.monthly / 100} <span className="text-xl font-medium text-gray-400">/ month</span></p>
                                {appliedCoupon ? <p className="text-lg text-gray-500 line-through">₹99</p> : <p className="text-lg text-gray-500 line-through">₹300</p>}
                            </div>
                        </div>
                        <button disabled={isProcessingPayment} onClick={() => onPlanSelect('monthly', discountedPrices.monthly)} className="w-full p-4 bg-gray-700 text-white font-bold rounded-xl hover:bg-gray-600 transition-all duration-300 text-lg shadow-lg mt-4 disabled:bg-gray-500 disabled:cursor-not-allowed">
                            {isProcessingPayment ? 'Processing...' : 'Get Started'}
                        </button>
                    </div>

                    <div className="w-full max-w-sm bg-gray-900/50 backdrop-blur-sm border-2 border-teal-400 rounded-2xl p-8 text-center relative shadow-2xl shadow-teal-500/20 transform flex flex-col">
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-teal-400 text-gray-900 font-bold px-4 py-1 rounded-full text-sm">
                            BEST VALUE
                        </div>
                        <div className="flex-grow">
                            <h3 className="text-2xl font-bold text-white">Pro Yearly</h3>
                            <p className="mt-2 text-teal-300">Save over 85%</p>
                            <div className="my-4">
                                <p className="text-5xl font-extrabold text-white">₹{discountedPrices.yearly / 100} <span className="text-xl font-medium text-gray-400">/ year</span></p>
                                {appliedCoupon ? <p className="text-lg text-gray-500 line-through">₹499</p> : <p className="text-lg text-gray-500 line-through">₹3599</p>}
                            </div>
                            <p className="text-lg text-gray-400 -mt-2 mb-4">(Just ₹{(discountedPrices.yearly / 12 / 100).toFixed(2)}/mo)</p>
                        </div>
                        <button disabled={isProcessingPayment} onClick={() => onPlanSelect('yearly', discountedPrices.yearly)} className="w-full p-4 bg-gradient-to-r from-teal-400 to-cyan-500 text-white font-bold rounded-xl hover:opacity-90 transition-opacity duration-300 text-lg shadow-lg shadow-teal-500/30 mt-4 disabled:opacity-50 disabled:cursor-not-allowed">
                             {isProcessingPayment ? 'Processing...' : 'Go Pro Yearly'}
                        </button>
                    </div>
                </div>
                
                <div className="my-16 max-w-sm mx-auto">
                    <form onSubmit={(e) => { e.preventDefault(); handleApplyCoupon(); }} className="flex gap-2">
                        <input type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="Enter Coupon Code" className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" />
                        <button type="submit" className="px-6 py-3 bg-gray-700 text-white font-bold rounded-lg hover:bg-gray-600 transition-colors">Apply</button>
                    </form>
                    {appliedCoupon && <p className="text-center text-green-400 mt-2">Applied: {appliedCoupon.discountPercentage}% off!</p>}
                </div>


                <div className="my-24 text-center">
                    <button onClick={() => setShowPreview(!showPreview)} className="px-8 py-4 bg-gray-800 text-teal-300 font-bold rounded-xl hover:bg-gray-700 transition-all duration-300 text-lg shadow-lg border border-teal-800/50">
                        {showPreview ? 'Hide the Sneak Peek' : 'Get a Sneak Peek of the Entire Setup'}
                    </button>
                </div>
                
                {showPreview && (
                    <div className="my-16 w-full overflow-x-auto">
                        <Dashboard
                            allData={sampleData}
                            isPreview={true}
                            setModal={setModal}
                            updateData={() => {}}
                            userId="preview_user"
                            onLogout={() => {}}
                            setView={() => {}}
                            modal={{ isOpen: false }}
                        />
                    </div>
                )}


                <div className="my-24">
                    <h2 className="text-center text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400 mb-16">What We Have to Offer?</h2>
                    {Object.entries(featureSections).map(([sectionTitle, features]) => (
                        <div key={sectionTitle} className="mb-16">
                            <div className="text-center mb-8">
                                <h3 className="inline-block relative text-2xl font-bold text-teal-300 pb-2">
                                    {sectionTitle}
                                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2/3 h-0.5 bg-gradient-to-r from-teal-500 to-cyan-500"></span>
                                </h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" onMouseMove={(e) => {
                                for(const card of document.querySelectorAll('.card-glow')) {
                                    const rect = card.getBoundingClientRect();
                                    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
                                    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
                                }
                            }}>
                                {features.map((feature) => (
                                    <div key={feature.title} className="card-glow bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-gray-700/50 transition-all duration-300 hover:border-teal-600/80">
                                        <div className="flex items-center gap-4">
                                            <div className="text-teal-400">{feature.icon}</div>
                                            <h3 className="font-bold text-white text-lg">{feature.title}</h3>
                                        </div>
                                        <p className="text-gray-400 mt-2 text-sm leading-relaxed">{feature.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};


const PerformanceCalendar = memo(({ dailyPnlData, onDayClick }) => {
    const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, content: null });

    const { weeks, months, maxAbsPnl } = useMemo(() => {
        const today = new Date();
        const endDate = new Date(today);
        const startDate = new Date(today);
        startDate.setMonth(startDate.getMonth() - 6); // Show 6 months

        const pnlMap = new Map(dailyPnlData.map(d => [d.date, d.pnl]));
        let maxAbsPnlValue = 0;

        const days = [];
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const pnl = pnlMap.get(dateStr);
            if (pnl !== undefined) {
                maxAbsPnlValue = Math.max(maxAbsPnlValue, Math.abs(pnl));
            }
            days.push({ date: dateStr, pnl: pnl, dayOfWeek: currentDate.getDay() });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        const weeksData = [];
        if (days.length > 0) {
            let currentWeek = Array(7).fill(null);
            days.forEach(day => {
                currentWeek[day.dayOfWeek] = day;
                if (day.dayOfWeek === 6) {
                    weeksData.push(currentWeek);
                    currentWeek = Array(7).fill(null);
                }
            });
            if (currentWeek.some(d => d !== null)) weeksData.push(currentWeek);
        }
        
        const monthLabels = [];
        let lastMonth = -1;
        weeksData.forEach((week, weekIndex) => {
            const firstDayOfWeek = week.find(d => d);
            if (firstDayOfWeek) {
                const month = new Date(firstDayOfWeek.date).getMonth();
                if (month !== lastMonth) {
                    monthLabels.push({ label: new Date(firstDayOfWeek.date).toLocaleString('default', { month: 'short' }), weekIndex });
                    lastMonth = month;
                }
            }
        });

        return { weeks: weeksData, months: monthLabels, maxAbsPnl: maxAbsPnlValue || 1 };
    }, [dailyPnlData]);

    const getDayColor = (pnl) => {
        if (pnl === undefined || pnl === null) return 'rgba(55, 65, 81, 0.5)'; // bg-gray-700/50
        if (pnl === 0) return 'rgba(107, 114, 128, 1)'; // bg-gray-500

        const intensity = Math.min(Math.abs(pnl) / maxAbsPnl, 1) * 0.8 + 0.2; // Scale from 0.2 to 1
        if (pnl > 0) return `rgba(52, 211, 153, ${intensity})`; // green-400 with variable opacity
        return `rgba(239, 68, 68, ${intensity})`; // red-500 with variable opacity
    };

    const handleMouseEnter = (e, day) => {
        if (!day || day.pnl === undefined) return;
        setTooltip({
            show: true,
            x: e.target.offsetLeft - 40,
            y: e.target.offsetTop - 55,
            content: (
                <>
                    <p className="font-bold">{day.date}</p>
                    <p className={day.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrencyPrecise(day.pnl)}</p>
                </>
            ),
        });
    };

    const handleMouseLeave = () => setTooltip({ ...tooltip, show: false });

    return (
        <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 relative">
            {tooltip.show && (
                <div style={{ top: `${tooltip.y}px`, left: `${tooltip.x}px` }} className="absolute z-10 p-2 bg-gray-900 border border-teal-700 text-white text-sm rounded-lg shadow-xl pointer-events-none transition-opacity duration-200">
                    {tooltip.content}
                </div>
            )}
            <h2 className="text-2xl font-bold text-teal-400 mb-4">Performance Heatmap (Last 6 Months)</h2>
            <div className="flex gap-2 overflow-x-auto pb-4">
                <div className="flex flex-col gap-1 text-xs text-gray-400 pr-2">
                     <div className="h-4"></div> {/* Sun */}
                     <div className="h-4 flex items-center">Mon</div>
                     <div className="h-4 flex items-center">Tue</div>
                     <div className="h-4 flex items-center">Wed</div>
                     <div className="h-4 flex items-center">Thu</div>
                     <div className="h-4 flex items-center">Fri</div>
                     <div className="h-4"></div> {/* Sat */}
                </div>
                <div className="relative">
                    <div className="flex gap-1">
                        {weeks.map((week, weekIndex) => (
                            <div key={weekIndex} className="flex flex-col gap-1">
                                {week.map((day, dayIndex) => (
                                    <div 
                                        key={day ? day.date : `empty-${weekIndex}-${dayIndex}`}
                                        className="w-4 h-4 rounded-sm cursor-pointer transition-transform duration-150 hover:scale-125 hover:ring-2 hover:ring-teal-400"
                                        style={{ backgroundColor: day ? getDayColor(day.pnl) : 'transparent' }}
                                        onMouseEnter={(e) => handleMouseEnter(e, day)}
                                        onMouseLeave={handleMouseLeave}
                                        onClick={() => onDayClick && onDayClick(day?.date)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className="absolute -top-5 left-0 flex">
                        {months.map(({label, weekIndex}) => (
                            <div key={label} className="text-xs text-gray-400" style={{position: 'absolute', left: `${weekIndex * 1.25}rem`}}>{label}</div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-center mt-4 gap-2 text-xs text-gray-400">
                <span>Loss</span>
                <div className="flex rounded-sm overflow-hidden">
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(-maxAbsPnl * 0.9)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(-maxAbsPnl * 0.4)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(0)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(maxAbsPnl * 0.4)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(maxAbsPnl * 0.9)}}></div>
                </div>
                <span>Profit</span>
            </div>
        </div>
    );
});

const ShareablePerformanceCard = React.forwardRef(({
  title,
  period,
  mainMetrics,
  secondaryMetrics,
  dailyBreakdown
}, ref) => {
    const formatCurrencyNoDecimals = (value) => `₹${(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    const StatCard = ({ label, value, roi, isPnl = false }) => {
        const isProfit = value >= 0;
        const colorClass = isPnl ? (isProfit ? 'text-emerald-400' : 'text-red-500') : 'text-cyan-400';
        const bgColorClass = isPnl ? (isProfit ? 'bg-emerald-900/50' : 'bg-red-900/50') : 'bg-cyan-900/50';
        
        return (
            <div className={`p-4 rounded-xl ${bgColorClass} border border-gray-700/50 flex flex-col`}>
                <p className="text-sm text-gray-400 font-medium mb-2">{label}</p>
                <div className="flex-grow" />
                <div>
                    <p className={`text-2xl font-bold leading-tight ${colorClass}`}>{formatCurrencyNoDecimals(value)}</p>
                    {roi !== undefined && (
                        <div className={`flex items-center text-sm font-semibold ${colorClass} mt-1 gap-1`}>
                            <span>{formatPercentage(roi)} ROI</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div ref={ref} className="bg-gradient-to-br from-gray-900 to-black text-white p-6 rounded-2xl w-full max-w-[480px] font-sans border border-teal-700/30 shadow-2xl shadow-teal-500/10 overflow-hidden relative">
            <div className="absolute -top-20 -right-20 w-60 h-60 bg-teal-500/10 rounded-full filter blur-3xl"></div>
            <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-violet-500/10 rounded-full filter blur-3xl"></div>

            <div className="relative z-10">
                <header className="flex justify-between items-start pb-4 border-b border-gray-700/50">
                    <div>
                        <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400">
                            {title}
                        </h2>
                        <p className="text-md text-gray-400">{period}</p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-lg bg-clip-text text-transparent bg-gradient-to-r from-gray-200 to-gray-400">PRO TRADER JOURNAL</p>
                        <p className="text-xs text-teal-400/70 tracking-widest">www.xponential.me</p>
                    </div>
                </header>

                <main className="my-6">
                    <div className="grid grid-cols-2 gap-4">
                        <StatCard label={mainMetrics.pnlLabel} value={mainMetrics.pnlValue} roi={mainMetrics.roiValue} isPnl={true} />
                        <StatCard label={mainMetrics.capitalLabel} value={mainMetrics.capitalValue} />
                    </div>
                    {secondaryMetrics && (
                         <div className="grid grid-cols-2 gap-4 mt-4">
                            <StatCard label={secondaryMetrics.pnlLabel} value={secondaryMetrics.pnlValue} roi={secondaryMetrics.roiValue} isPnl={true} />
                            <StatCard label={secondaryMetrics.capitalLabel} value={secondaryMetrics.capitalValue} />
                        </div>
                    )}
                </main>
                
                {dailyBreakdown && dailyBreakdown.length > 0 && (
                    <div className="mt-4 border-t border-gray-700/50 pt-3">
                        <h3 className="text-lg font-bold text-teal-300 mb-2 text-center">Daily Breakdown</h3>
                        <div className="max-h-32 overflow-y-auto text-xs space-y-1 pr-2">
                            {dailyBreakdown.map(day => (
                                <div key={day.date} className="flex justify-between items-center bg-gray-800/50 p-1 rounded">
                                    <span>{new Date(day.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                                    <span className={day.pnl >= 0 ? 'text-emerald-400 font-mono' : 'text-red-500 font-mono'}>
                                        {formatCurrencyNoDecimals(day.pnl)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                <footer className="text-center mt-4 border-t border-gray-700/50 pt-3">
                    <p className="text-xs text-gray-500">Track your journey to profitability. Generated by Pro Trader Journal.</p>
                </footer>
            </div>
        </div>
    );
});


const Dashboard = ({ allData, updateData, userId, onLogout, modal, setModal, db, setView, isPreview = false, handleStartRenewal }) => {
    // --- STATE MANAGEMENT ---
    const [selectedJournalId, setSelectedJournalId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [visibleTradeCount, setVisibleTradeCount] = useState(TRADES_PER_PAGE);
    const [newTrade, setNewTrade] = useState(() => {
        const today = new Date();
        const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
        return { date: todayLocal.toISOString().split('T')[0], day: DAY_NAME_MAPPING[today.getDay()], grossPnl: '', taxesAndCharges: '', capitalDeployed: '', notes: '' };
    });
    const [expandedTradeIds, setExpandedTradeIds] = useState([]);
    const [highlightedDate, setHighlightedDate] = useState(null);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const [isExpired, setIsExpired] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [hasAnimated, setHasAnimated] = useState(false);
    const [shareData, setShareData] = useState(null);
    const shareCardRef = React.useRef();

    // --- DERIVED STATE & MEMOIZATION (MOVED UP) ---
    const currentUserData = useMemo(() => allData || { journals: [], trades: {} }, [allData]);
    const journals = currentUserData.journals || [];
    const trades = useMemo(() => (selectedJournalId ? currentUserData.trades?.[selectedJournalId] : []) || [], [currentUserData, selectedJournalId]);
    const userInfo = currentUserData?.userInfo;
    const userName = userInfo?.name;
    const selectedJournal = useMemo(() => journals.find(j => j.id === selectedJournalId), [journals, selectedJournalId]);
    const summary = useMemo(() => {
        const initialCapital = selectedJournal ? parseFloat(selectedJournal.initialCapital) : 0;
        return calculateAnalytics(trades, initialCapital);
    }, [trades, selectedJournal]);
    
    // --- Subscription Check ---
    useEffect(() => {
        if (userInfo && userInfo.expiryDate && !isPreview) {
            if (new Date().getTime() > userInfo.expiryDate) {
                setIsExpired(true);
            }
        }
    }, [userInfo, isPreview]);
    
    // --- Initial Animation ---
    useEffect(() => {
        const timer = setTimeout(() => setHasAnimated(true), 50);
        return () => clearTimeout(timer);
    }, []);

    // --- Responsive handler ---
    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- SET INITIAL JOURNAL & FORM DEFAULTS ---
    useEffect(() => {
        if (journals.length > 0 && !journals.some(j => j.id === selectedJournalId)) {
            setSelectedJournalId(journals[0].id);
        } else if (journals.length === 0) {
            setSelectedJournalId('');
        }
    }, [journals, selectedJournalId]);

    useEffect(() => {
        if (trades && trades.length > 0) {
            const latestCapital = [...trades].sort((a,b) => new Date(b.date) - new Date(a.date))[0].capitalDeployed;
            setNewTrade(prev => ({ ...prev, capitalDeployed: latestCapital || '' }));
        } else if (selectedJournal) {
            setNewTrade(prev => ({ ...prev, capitalDeployed: selectedJournal.initialCapital || '' }));
        }
    }, [trades, journals, selectedJournalId, selectedJournal]);
    
    const sortedTradesForDisplay = useMemo(() => [...trades].sort((a,b) => new Date(b.date) - new Date(a.date)), [trades]);
    
    // --- Dynamic chart interval for mobile readability ---
    const tickInterval = useMemo(() => {
        const tradeCount = summary.dailyPnlData?.length || 0;
        if (windowWidth < 768) return Math.max(1, Math.floor(tradeCount / 5));
        return Math.max(1, Math.floor(tradeCount / 10));
    }, [summary.dailyPnlData, windowWidth]);

    const handlePreviewClick = () => setModal({ isOpen: true, type: 'alert', message: 'This feature is disabled in the preview. Please register to get full access!' });

    // --- EVENT HANDLERS ---
    const handleInputChange = (e, setState) => {
        const { name, value } = e.target;
        setState(prev => {
            let updated = { ...prev, [name]: value };
            if (name === 'date' && value) { const date = new Date(value); updated.day = DAY_NAME_MAPPING[date.getUTCDay()]; }
            return updated;
        });
    };

    const handleCreateJournal = (e) => {
        e.preventDefault();
        if (isPreview) { handlePreviewClick(); return; }
        const form = e.target;
        const name = form.name.value;
        const initialCapital = form.initialCapital.value;
        if (!name || !initialCapital) { setModal({ isOpen: true, type: 'alert', message: 'Please provide a name and initial capital.' }); return; }
        
        const newJournal = { id: generateUniqueId(), name, initialCapital: parseFloat(initialCapital), createdAt: new Date().toISOString() };
        const newData = { ...currentUserData, journals: [...(currentUserData.journals || []), newJournal] };
        updateData(newData);
        setSelectedJournalId(newJournal.id);
        setModal({ isOpen: false });
    };

    const handleDeleteJournal = () => {
        if (isPreview) { handlePreviewClick(); return; }
        if (!selectedJournal) return;
        setModal({
            isOpen: true,
            type: 'confirm',
            message: `Delete "${selectedJournal.name}" and all its trades? This action cannot be undone.`,
            onConfirm: () => {
                const newJournals = currentUserData.journals.filter(j => j.id !== selectedJournalId);
                const newTrades = { ...currentUserData.trades };
                delete newTrades[selectedJournalId];

                const newData = { ...currentUserData, journals: newJournals, trades: newTrades };
                updateData(newData);
                setSelectedJournalId(newJournals.length > 0 ? newJournals[0].id : '');
                setModal({ isOpen: false });
            }
        });
    };

    const handleAddTrade = async (e) => {
        e.preventDefault();
        if (isPreview) { handlePreviewClick(); return; }
        if (!newTrade.date || newTrade.grossPnl === '' || newTrade.taxesAndCharges === '' || newTrade.capitalDeployed === '') {
            setModal({ isOpen: true, type: 'alert', message: 'Please fill out all fields.' });
            return;
        }
    
        const tradeToAdd = {
            id: generateUniqueId(),
            date: newTrade.date,
            day: newTrade.day,
            grossPnl: parseFloat(newTrade.grossPnl),
            taxesAndCharges: parseFloat(newTrade.taxesAndCharges),
            capitalDeployed: parseFloat(newTrade.capitalDeployed),
            notes: newTrade.notes || ""
        };
    
        if (userId === '0000000000' || userId === '1111111111') {
            const newTradesForJournal = [...(currentUserData.trades?.[selectedJournalId] || []), tradeToAdd];
            const newData = { 
                ...currentUserData, 
                trades: { 
                    ...currentUserData.trades, 
                    [selectedJournalId]: newTradesForJournal 
                } 
            };
            updateData(newData);
        } else {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, userId);
            const tradePath = `trades.${selectedJournalId}`;
            try {
                await updateDoc(docRef, {
                    [tradePath]: arrayUnion(tradeToAdd)
                });
            } catch (error) {
                console.error("Error adding trade:", error);
                setModal({ isOpen: true, type: 'alert', message: 'Could not add trade. Please try again.' });
            }
        }
    
        const today = new Date();
        const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
        setNewTrade(prev => ({
            ...prev,
            date: todayLocal.toISOString().split('T')[0],
            day: DAY_NAME_MAPPING[today.getDay()],
            grossPnl: '',
            taxesAndCharges: '',
            notes: ''
        }));
    };
    
    const handleEditTrade = (tradeToEdit) => {
        if (isPreview) { handlePreviewClick(); return; }
        setModal({
            isOpen: true,
            type: 'editTrade',
            message: 'Edit Trade',
            onConfirm: handleUpdateTrade,
            defaultValues: tradeToEdit
        });
    };

    const handleUpdateTrade = (e) => {
        e.preventDefault();
        const form = e.target;
        const { defaultValues } = modal;
        const updatedTrade = {
            ...defaultValues,
            date: form.date.value,
            day: DAY_NAME_MAPPING[new Date(form.date.value).getUTCDay()],
            grossPnl: parseFloat(form.grossPnl.value),
            taxesAndCharges: parseFloat(form.taxesAndCharges.value),
            capitalDeployed: parseFloat(form.capitalDeployed.value),
            notes: form.notes.value,
        };

        const newTradesForJournal = (currentUserData.trades[selectedJournalId] || []).map(t =>
            t.id === updatedTrade.id ? updatedTrade : t
        );

        const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
        updateData(newData);
        setModal({ isOpen: false });
    };

    const handleDeleteTrade = (idToDelete) => {
        if (isPreview) { handlePreviewClick(); return; }
        setModal({ isOpen: true, type: 'confirm', message: 'Are you sure you want to delete this record?',
            onConfirm: () => {
                const newTradesForJournal = currentUserData.trades[selectedJournalId].filter(t => t.id !== idToDelete);
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };

    const handleDeleteAllTrades = () => {
        if (isPreview) { handlePreviewClick(); return; }
        if (!trades || trades.length === 0) { setModal({ isOpen: true, type: 'alert', message: 'There are no records to delete.' }); return; }
        setModal({ isOpen: true, type: 'confirm', message: 'Are you sure you want to delete ALL records in this journal?',
            onConfirm: () => {
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: [] } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };
    
    const handleShare = async () => {
        if (isPreview) { handlePreviewClick(); return; }
        if (!window.html2canvas) {
            setModal({ isOpen: true, type: 'alert', message: 'Sharing library not loaded. Please try again in a moment.' });
            return;
        }
        setIsLoading(true);
        // Delay to allow modal to render with new data
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
            const canvas = await window.html2canvas(shareCardRef.current, {
                backgroundColor: null,
                useCORS: true
            });
            const imageUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = imageUrl;
            link.download = `${shareData.title.replace(/\s+/g, '_')}_${shareData.period.replace(/\s+/g, '_')}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error("Error generating share image:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Could not generate shareable image.' });
        } finally {
            setIsLoading(false);
            setShareData(null); // Close modal
        }
    };

    const prepareShareData = (type, data) => {
        if (type === 'daily') {
            const trade = data;
            const netPnl = trade.grossPnl - trade.taxesAndCharges;
            const roi = trade.capitalDeployed > 0 ? (netPnl / trade.capitalDeployed) * 100 : 0;
            setShareData({
                title: "Daily Performance",
                period: new Date(trade.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                mainMetrics: {
                    pnlLabel: "Net P&L",
                    pnlValue: netPnl,
                    roiValue: roi,
                    capitalLabel: "Capital Deployed",
                    capitalValue: trade.capitalDeployed
                }
            });
        } else if (type === 'monthly') {
            const monthData = data;
            const monthDate = new Date(monthData.date);
            const month = monthDate.getMonth();
            const year = monthDate.getFullYear();

            const dailyBreakdown = summary.dailyPnlData
                .filter(d => {
                    const tradeDate = new Date(d.date);
                    return tradeDate.getMonth() === month && tradeDate.getFullYear() === year;
                })
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            setShareData({
                title: "Monthly Performance",
                period: monthData.month,
                mainMetrics: {
                    pnlLabel: "Total Net P&L",
                    pnlValue: monthData.netPnl,
                    roiValue: monthData.monthlyReturn,
                    capitalLabel: "Avg. Capital",
                    capitalValue: monthData.capitalDeployed
                },
                dailyBreakdown: dailyBreakdown
            });
        } else if (type === 'latest') {
            if (sortedTradesForDisplay.length === 0) return;
            const latestTrade = sortedTradesForDisplay[0];
            const netPnl = latestTrade.grossPnl - latestTrade.taxesAndCharges;
            const roi = latestTrade.capitalDeployed > 0 ? (netPnl / latestTrade.capitalDeployed) * 100 : 0;
            const monthData = summary.monthlyPerformance.find(m => m.month === new Date(latestTrade.date).toLocaleString('default', { month: 'short', year: 'numeric' }));

            setShareData({
                title: "Performance Snapshot",
                period: new Date(latestTrade.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                mainMetrics: {
                    pnlLabel: "Latest Day's P&L",
                    pnlValue: netPnl,
                    roiValue: roi,
                    capitalLabel: "Capital Deployed",
                    capitalValue: latestTrade.capitalDeployed
                },
                secondaryMetrics: monthData ? {
                    pnlLabel: `${monthData.month} P&L`,
                    pnlValue: monthData.netPnl,
                    roiValue: monthData.monthlyReturn,
                    capitalLabel: `Avg. Capital (${monthData.month})`,
                    capitalValue: monthData.capitalDeployed
                } : null
            });
        }
    };


    const handleExportCSV = () => {
        if (isPreview) { handlePreviewClick(); return; }
        if (!trades || trades.length === 0) { setModal({ isOpen: true, type: 'alert', message: 'No records to export.' }); return; }
        const headers = ['ID', 'Date', 'Day', 'Gross P&L', 'Taxes & Charges', 'Net P&L', 'Capital Deployed', 'Notes'];
        const csvContent = [ headers.join(','),
          ...sortedTradesForDisplay.map(trade => {
            const netPnl = (trade.grossPnl || 0) - (trade.taxesAndCharges || 0);
            const notes = `"${(trade.notes || '').replace(/"/g, '""')}"`;
            return [trade.id, trade.date, trade.day, trade.grossPnl, trade.taxesAndCharges, netPnl.toFixed(2), trade.capitalDeployed, notes].join(',');
          })
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `${selectedJournal.name.replace(/\s+/g, '_')}_performance.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleLoadSampleData = () => {
        if (isPreview) { handlePreviewClick(); return; }
        setModal({ isOpen: true, type: 'confirm', message: 'This will add sample data to this journal. Are you sure?',
            onConfirm: () => {
                const sampleTrades = generateSampleTrades(125, selectedJournal?.initialCapital || 500000);
                const newTradesForJournal = [...(currentUserData.trades?.[selectedJournalId] || []), ...sampleTrades];
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };
    
    const handleDayClickFromCalendar = (date) => {
        if (!date) return;
        const tradeForDate = sortedTradesForDisplay.find(t => t.date === date);
        if (tradeForDate) {
            setHighlightedDate(date);
            const tradeElement = document.getElementById(`trade-row-${tradeForDate.id}`);
            if (tradeElement) {
                tradeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setExpandedTradeIds(prev => prev.includes(tradeForDate.id) ? prev : [...prev, tradeForDate.id]);
            }
            setTimeout(() => setHighlightedDate(null), 2500);
        }
    };

    const toggleTradeRow = (tradeId) => {
        setExpandedTradeIds(prev =>
            prev.includes(tradeId)
                ? prev.filter(id => id !== tradeId)
                : [...prev, tradeId]
        );
    };
    
    const Icon = memo(({ path, className = "h-6 w-6" }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>);

    const ExpiryOverlay = () => (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex flex-col justify-center items-center z-50 p-4 text-center">
            <h2 className="text-4xl font-extrabold text-red-500 mb-4">Plan Expired</h2>
            <p className="text-lg text-gray-200 mb-8">Your access to the Pro Trader Journal has expired. Please renew your plan to continue.</p>
            <button onClick={handleStartRenewal} className="px-8 py-4 bg-gradient-to-r from-teal-400 to-cyan-500 text-white font-bold rounded-xl hover:opacity-90 transition-opacity duration-300 text-lg shadow-lg shadow-teal-500/30">
                Renew Your Plan
            </button>
        </div>
    );

    const ProfileModal = () => (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4" onClick={() => setIsProfileModalOpen(false)}>
            <div className="bg-gray-800 border border-teal-700 rounded-xl p-6 w-full max-w-lg text-left shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-teal-400">My Profile</h2>
                    <button onClick={() => setIsProfileModalOpen(false)} className="p-1 rounded-full hover:bg-gray-700">
                        <Icon path="M6 18L18 6M6 6l12 12" className="h-5 w-5 text-gray-400" />
                    </button>
                </div>
                <div className="space-y-4">
                    <p><strong className="text-gray-400 w-32 inline-block">Access Code:</strong> <span className="font-mono text-teal-300">{userId}</span></p>
                    <p><strong className="text-gray-400 w-32 inline-block">Current Plan:</strong> <span className="capitalize font-semibold text-white">{userInfo?.plan}</span></p>
                    <p><strong className="text-gray-400 w-32 inline-block">Expires On:</strong> <span className="font-semibold text-amber-400">{new Date(userInfo?.expiryDate).toLocaleDateString()}</span></p>
                </div>

                <h3 className="text-xl font-bold text-teal-400 mt-8 mb-4">Payment History</h3>
                <div className="max-h-48 overflow-y-auto border border-gray-700 rounded-lg">
                    <table className="min-w-full">
                        <thead className="sticky top-0 bg-gray-800/95 backdrop-blur-sm"><tr className="text-left text-xs text-gray-400 uppercase"><th className="p-3">Date</th><th className="p-3">Plan</th><th className="p-3">Amount</th><th className="p-3">Payment ID</th></tr></thead>
                        <tbody>
                            {userInfo?.paymentHistory && userInfo.paymentHistory.length > 0 ? (
                                [...userInfo.paymentHistory].reverse().map((p, i) => (
                                    <tr key={i} className="border-t border-gray-700"><td className="p-3 text-sm">{new Date(p.date).toLocaleDateString()}</td><td className="p-3 text-sm capitalize">{p.plan}</td><td className="p-3 text-sm">₹{p.amount / 100}</td><td className="p-3 text-xs font-mono text-gray-500">{p.paymentId}</td></tr>
                                ))
                            ) : (
                                <tr><td colSpan="4" className="p-6 text-center text-gray-400">No payment history found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-8 text-center">
                    <button onClick={() => { setIsProfileModalOpen(false); handleStartRenewal(); }} className="px-6 py-3 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 transition-all duration-300 transform hover:scale-105">
                        Renew / Upgrade Plan
                    </button>
                </div>
            </div>
        </div>
    );
    
    const ShareModal = () => (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4" onClick={() => setShareData(null)}>
            <div className="bg-transparent" onClick={e => e.stopPropagation()}>
                <ShareablePerformanceCard ref={shareCardRef} {...shareData} />
                <div className="mt-4 text-center">
                    <button onClick={handleShare} disabled={isLoading} className="px-6 py-3 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 transition-all duration-300 transform hover:scale-105">
                        {isLoading ? 'Downloading...' : 'Download Image'}
                    </button>
                </div>
            </div>
        </div>
    );

    // --- RENDER ---
    return (
        <div className="container mx-auto max-w-7xl p-2 sm:p-4 md:p-6 rounded-2xl shadow-[0_0_60px_-15px_rgba(20,184,166,0.2)] bg-gray-900 border border-teal-800/50 text-gray-100 font-sans relative dashboard-container">
            {isExpired && <ExpiryOverlay />}
            {isProfileModalOpen && <ProfileModal />}
            {shareData && <ShareModal />}
            
            <header className="mb-10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <button onClick={() => setIsProfileModalOpen(true)} className={`px-4 py-2 bg-gray-700/50 text-white font-bold rounded-lg shadow-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-teal-500 transition-all duration-300 transform hover:scale-105 flex items-center gap-2 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Icon path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" className="h-5 w-5" />
                    Profile
                </button>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide text-center order-first sm:order-none">PRO TRADER JOURNAL</h1>
                <button onClick={isPreview ? handlePreviewClick : onLogout} className={`px-4 py-2 bg-red-600/80 text-white font-bold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}>Logout</button>
            </header>

            <div className="bg-gray-800/40 p-4 rounded-xl shadow-lg border border-gray-700/70 mb-10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <label htmlFor="journal-select" className="text-lg font-bold text-teal-400">Journal:</label>
                    <select id="journal-select" value={selectedJournalId} onChange={(e) => setSelectedJournalId(e.target.value)} className="p-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all w-full sm:w-64">
                        {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <button onClick={() => setModal({ isOpen: true, type: 'createJournal', onConfirm: handleCreateJournal })} className={`w-full sm:w-auto px-4 py-2 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-teal-500 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}> + New Journal </button>
                    {selectedJournal && (
                        <button onClick={handleDeleteJournal} className={`w-full sm:w-auto px-4 py-2 bg-red-600/80 text-white font-bold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}>Delete Journal</button>
                    )}
                </div>
            </div>
            
            {journals.length === 0 && (
                <div className="text-center p-10 bg-gray-800/30 rounded-lg">
                    <h2 className="text-2xl font-bold text-teal-400">Welcome!</h2>
                    <p className="text-gray-300 mt-2 mb-4">Create your first journal to start tracking your daily records.</p>
                    <button onClick={() => setModal({ isOpen: true, type: 'createJournal', onConfirm: handleCreateJournal })} className={`px-6 py-3 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}>+ Create First Journal</button>
                </div>
            )}

            {selectedJournal && (
            <div className={hasAnimated ? 'opacity-100' : 'opacity-0'}>
                {/* Metric Cards Sections */}
                <div className="mb-10"><h2 className="flex items-center gap-3 text-2xl font-bold text-teal-400 mb-4 section-header"><Icon path="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />Account Overview</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard isVisible={hasAnimated} delay={1} title="Current Equity" value={formatCurrencyCompact(summary.currentEquity)} colorClass={summary.currentEquity >= summary.startingCapital ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard isVisible={hasAnimated} delay={2} title="Overall P&L" value={formatCurrencyCompact(summary.overallPnl)} colorClass={summary.overallPnl >= 0 ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard isVisible={hasAnimated} delay={3} title="Average Capital" value={formatCurrencyCompact(summary.averageCapital)} /><MemoizedMetricCard isVisible={hasAnimated} delay={4} title="Return on Investment" value={formatPercentage(summary.roi)} colorClass={summary.roi >= 0 ? 'text-green-400' : 'text-red-400'} /></div></div>
                <div className="mb-10"><h2 className="flex items-center gap-3 text-2xl font-bold text-teal-400 mb-4 section-header"><Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />Performance Metrics</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard isVisible={hasAnimated} delay={1} title="Win Rate" value={formatPercentage(summary.winRate)} colorClass="text-green-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={2} title="Profit Factor" value={(summary.profitFactor || 0).toFixed(2)} colorClass="text-cyan-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={3} title="Win/Loss Ratio" value={(summary.winLossRatio || 0).toFixed(2)} colorClass="text-cyan-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={4} title="Expectancy" value={formatCurrencyCompact(summary.expectancy)} colorClass={(summary.expectancy || 0) >= 0 ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard isVisible={hasAnimated} delay={5} title="Avg. Win" value={formatCurrencyPrecise(summary.avgProfitOnWinDays)} colorClass="text-green-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={6} title="Avg. Loss" value={formatCurrencyPrecise(summary.avgLossOnLossDays)} colorClass="text-red-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={7} title="Total Days" value={summary.totalTrades || 0} /><MemoizedMetricCard isVisible={hasAnimated} delay={8} title="Profitable Days" value={summary.winDays || 0} colorClass="text-green-400" /></div></div>
                <div className="mb-10"><h2 className="flex items-center gap-3 text-2xl font-bold text-teal-400 mb-4 section-header"><Icon path="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />Risk & Extremes</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard isVisible={hasAnimated} delay={1} title="Max Drawdown" value={formatPercentage(summary.maxDDPercentage)} colorClass="text-red-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={2} title="Max Drawdown (Abs)" value={formatCurrencyCompact(summary.maxDrawdown)} colorClass="text-red-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={3} title="Max Profit" value={formatCurrencyCompact(summary.maxProfit)} colorClass="text-green-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={4} title="Max Loss" value={formatCurrencyCompact(summary.maxLoss)} colorClass="text-red-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={5} title="Winning Streak" value={summary.maxWinningStreak || 0} colorClass="text-green-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={6} title="Losing Streak" value={summary.maxLosingStreak || 0} colorClass="text-red-400" /><MemoizedMetricCard isVisible={hasAnimated} delay={7} title="Losing Days" value={summary.lossDays || 0} colorClass="text-red-400" /></div></div>
                
                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">Equity Curve</h2><ResponsiveContainer width="100%" height="85%"><LineChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} domain={['auto', 'auto']} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(value), name]} /><Legend wrapperStyle={{ fontSize: '14px', color: '#e5e7eb' }} /><Line type="monotone" dataKey="equity" name="Equity" stroke="#2dd4bf" strokeWidth={2} dot={false} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">Drawdown</h2><ResponsiveContainer width="100%" height="85%"><AreaChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}><defs><linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} domain={['auto', 0]} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(value), name]} /><Area type="monotone" dataKey="drawdown" name="Drawdown" stroke="#ef4444" fillOpacity={1} fill="url(#colorDrawdown)" strokeWidth={2} dot={false} activeDot={{ r: 6 }} /></AreaChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96 lg:col-span-2"><h2 className="text-xl font-bold text-teal-400 mb-4">Daily P&L</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 20, bottom: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatCurrencyPrecise(value), 'Daily P&L']} cursor={{fill: 'rgba(148, 163, 184, 0.1)'}} /><Bar dataKey="pnl" name="Daily P&L">{summary.dailyPnlData?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#34d399' : '#ef4444'} />)}</Bar></BarChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">Capital Deployed</h2><ResponsiveContainer width="100%" height="85%"><LineChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} domain={['auto', 'auto']} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(value), name]} /><Legend wrapperStyle={{ fontSize: '14px', color: '#e5e7eb' }} /><Line type="monotone" dataKey="capital" name="Capital" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">P&L by Day of Week</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.pnlByDayOfWeek} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="day" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb' }} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={formatCurrencyCompact} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatCurrencyPrecise(value), 'Total P&L']} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} /><Bar dataKey="pnl" name="Total P&L">{summary.pnlByDayOfWeek?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#2dd4bf' : '#f43f5e'} />)}</Bar></BarChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96 lg:col-span-2"><h2 className="text-xl font-bold text-teal-400 mb-4">P&L Distribution (% of Capital)</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.pnlDistribution} margin={{ top: 5, right: 20, left: 20, bottom: 60 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="name" stroke="#e5e7eb" fontSize={10} interval={0} angle={-45} textAnchor="end" height={80} /><YAxis allowDecimals={false} stroke="#e5e7eb" fontSize={12} label={{ value: 'No. of Days', angle: -90, position: 'insideLeft', fill: '#e5e7eb', fontSize: 14 }} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [value, 'Days']} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} /><Bar dataKey="trades">{summary.pnlDistribution?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
                </div>
                
                {/* Add Trade Form */}
                <div className="bg-gray-800/40 p-6 rounded-xl shadow-lg border border-gray-700/70 mb-10"><h2 className="text-2xl font-bold text-teal-400 mb-4">Add Day's Record</h2><form onSubmit={handleAddTrade} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start"><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Date</label><input type="date" name="date" value={newTrade.date} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Gross P&L (₹)</label><input type="number" name="grossPnl" value={newTrade.grossPnl} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" placeholder="e.g., 5000" step="0.01" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Charges (₹)</label><input type="number" name="taxesAndCharges" value={newTrade.taxesAndCharges} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" placeholder="e.g., 500" step="0.01" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Capital (₹)</label><input type="number" name="capitalDeployed" value={newTrade.capitalDeployed} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" placeholder="Capital for this day" step="1" required/></div><div className="sm:col-span-2 lg:col-span-3 flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Notes / Strategy</label><textarea name="notes" value={newTrade.notes} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg w-full text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all" placeholder="e.g., Faded the morning rally..." rows="1"></textarea></div><button type="submit" disabled={isLoading || isPreview} className={`w-full p-3 self-end bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all duration-300 transform hover:scale-105 disabled:bg-gray-500 disabled:scale-100 ${isPreview ? 'cursor-not-allowed' : ''}`}>{isLoading ? <span className="animate-pulse">Adding...</span> : 'Add Record'}</button></form></div>

                {/* Tables Section */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto"><h2 className="text-2xl font-bold text-teal-400 mb-4">Monthly Performance</h2><div className="max-h-96 overflow-y-auto"><table className="min-w-full"><thead className="border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase tracking-wider text-left"><th className="p-3 font-semibold">Month</th><th className="p-3 font-semibold">Net P&L</th><th className="p-3 font-semibold">Avg. Capital</th><th className="p-3 font-semibold">Return</th></tr></thead><tbody>{summary.monthlyPerformance?.length > 0 ? summary.monthlyPerformance.map(m => (<tr key={m.month} className="border-b border-gray-700/50 hover:bg-gray-800/60 transition-colors"><td className="p-3 whitespace-nowrap">{m.month}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.netPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyCompact(m.netPnl)}</td><td className="p-3 whitespace-nowrap text-gray-300">{formatCurrencyCompact(m.capitalDeployed)}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.monthlyReturn || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercentage(m.monthlyReturn)}</td></tr>)) : (<tr><td colSpan="4" className="p-8 text-center text-gray-400">No monthly data to display.</td></tr>)}</tbody></table></div></div>
                    <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto">
                        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
                            <h2 className="text-2xl font-bold text-teal-400">Daily History ({trades.length})</h2>
                            <div className="flex gap-2 flex-wrap">
                                <button onClick={() => prepareShareData('latest')} disabled={isLoading} className={`p-2 bg-violet-600/80 text-white font-bold rounded-lg hover:bg-violet-700 transition-all duration-300 flex items-center gap-2 transform hover:scale-105 disabled:bg-gray-500 disabled:scale-100 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`} aria-label="Share Performance"><Icon path="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.368a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" className="h-5 w-5" /><span className="hidden sm:inline">Share</span></button>
                                <button onClick={handleLoadSampleData} className={`p-2 bg-indigo-600/80 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}><span className="hidden sm:inline">Load Sample</span><Icon path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" className="h-5 w-5 sm:hidden" /></button>
                                <button onClick={handleDeleteAllTrades} className={`p-2 bg-red-600/80 text-white font-bold rounded-lg hover:bg-red-700 transition-all duration-300 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`} aria-label="Delete All Records"><Icon path="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" className="h-5 w-5"/></button>
                                <button onClick={handleExportCSV} className={`p-2 bg-teal-500/80 text-white font-bold rounded-lg hover:bg-teal-600 transition-all duration-300 flex items-center gap-2 transform hover:scale-105 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`} aria-label="Export to CSV"><Icon path="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" className="h-5 w-5" /><span className="hidden sm:inline">Export</span></button>
                            </div>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            <table className="min-w-full"><thead className="sticky top-0 bg-gray-800/95 backdrop-blur-sm border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase text-left"><th className="p-3">Date</th><th className="p-3">Net P&L</th><th className="p-3 text-right">Actions</th></tr></thead>
                                <tbody>
                                    {sortedTradesForDisplay.slice(0, visibleTradeCount).map(trade => {
                                        const netPnl = (trade.grossPnl || 0) - (trade.taxesAndCharges || 0);
                                        const isExpanded = expandedTradeIds.includes(trade.id);
                                        return (
                                            <React.Fragment key={trade.id}>
                                                <tr id={`trade-row-${trade.id}`} onClick={() => toggleTradeRow(trade.id)} className={`border-b border-gray-700/50 hover:bg-gray-800/60 cursor-pointer transition-all duration-300 ${highlightedDate === trade.date ? 'bg-teal-500/20' : ''}`}>
                                                    <td className="p-3">{trade.date}</td>
                                                    <td className={`p-3 font-semibold ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyPrecise(netPnl)}</td>
                                                    <td className="p-3 text-right space-x-1">
                                                        <button onClick={(e) => { e.stopPropagation(); prepareShareData('daily', trade); }} className={`p-1.5 bg-violet-600/20 text-violet-400 hover:bg-violet-500 hover:text-white rounded-md transition-colors transform hover:scale-110 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}><Icon path="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.368a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" className="h-4 w-4" /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleEditTrade(trade); }} className={`p-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded-md transition-colors transform hover:scale-110 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}><Icon path="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z" className="h-4 w-4" /></button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTrade(trade.id); }} className={`p-1.5 bg-red-600/20 text-red-400 hover:bg-red-500 hover:text-white rounded-md transition-colors transform hover:scale-110 ${isPreview ? 'opacity-50 cursor-not-allowed' : ''}`}><Icon path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" className="h-4 w-4" /></button>
                                                    </td>
                                                </tr>
                                                {isExpanded && (<tr className="bg-gray-800/50"><td colSpan="3" className="p-4"><div className="text-gray-300"><p><strong className="text-teal-400">Gross P&L:</strong> {formatCurrencyPrecise(trade.grossPnl)}</p><p><strong className="text-teal-400">Charges:</strong> {formatCurrencyPrecise(trade.taxesAndCharges)}</p><p><strong className="text-teal-400">Capital:</strong> {formatCurrencyPrecise(trade.capitalDeployed)}</p>{trade.notes && <p className="mt-2"><strong className="text-teal-400">Notes:</strong> {trade.notes}</p>}</div></td></tr>)}
                                            </React.Fragment>
                                        );
                                    })}
                                     {trades.length === 0 && (<tr><td colSpan="3" className="p-8 text-center text-gray-400">No records yet.</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                         {visibleTradeCount < trades.length && (<div className="mt-4 text-center"><button onClick={() => setVisibleTradeCount(prev => prev + TRADES_PER_PAGE)} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors duration-300">Load More</button></div>)}
                    </div>
                </div>
                 <div className="mb-10"><PerformanceCalendar dailyPnlData={summary.dailyPnlData} onDayClick={handleDayClickFromCalendar} /></div>

                 <footer className="text-center mt-8 pt-6 border-t border-gray-800/50">
                    {userInfo?.expiryDate && <p className="text-amber-400/80 text-xs sm:text-sm">Plan expires on: {new Date(userInfo.expiryDate).toLocaleDateString()}</p>}
                </footer>
            </div>
            )}
        </div>
    );
}

const AdminLogin = ({ onAdminLogin, isLoading, setView, setModal }) => {
    const [password, setPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onAdminLogin(password);
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans">
             <div className="absolute inset-0 -z-10 h-full w-full bg-gray-950 bg-[radial-gradient(#ef4444_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
            <div className="w-full max-w-sm">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-amber-500">Admin Access</h1>
                    <p className="text-gray-400 mt-2">Enter the administrator password.</p>
                </header>
                <div className="bg-gray-900/50 backdrop-blur-sm border border-red-800/50 rounded-2xl shadow-2xl p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <input 
                            type="password" 
                            placeholder="Password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500 transition-all" 
                            required 
                        />
                        <button 
                            type="submit" 
                            disabled={isLoading} 
                            className="w-full p-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all transform hover:scale-105 disabled:bg-gray-500 disabled:scale-100"
                        >
                            {isLoading ? <span className="animate-pulse">Authenticating...</span> : 'Login'}
                        </button>
                    </form>
                    <p className="text-center text-gray-500 mt-6 text-sm">
                        <button onClick={() => setView('landing')} className="hover:text-gray-300 transition-colors">
                            &larr; Back to Home
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};


// --- ADMIN PANEL COMPONENT (UPDATED) ---
const AdminPanel = ({ db, setView, setModal }) => {
    const [coupons, setCoupons] = useState([]);
    const [users, setUsers] = useState([]);
    const [newCoupon, setNewCoupon] = useState({ code: '', discountPercentage: 10, isActive: true });
    const [isLoadingCoupons, setIsLoadingCoupons] = useState(true);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [userNotes, setUserNotes] = useState({});

    // Fetch coupons and users on component mount
    useEffect(() => {
        if (!db) return;

        // Fetch Coupons
        const couponsRef = collection(db, 'artifacts', appId, 'public', 'data', COUPONS_COLLECTION_NAME);
        const unsubCoupons = onSnapshot(couponsRef, (querySnapshot) => {
            const couponsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCoupons(couponsData);
            setIsLoadingCoupons(false);
        }, (error) => {
            console.error("Error fetching coupons:", error);
            setIsLoadingCoupons(false);
            setModal({ isOpen: true, type: 'alert', message: 'Could not fetch coupon data.' });
        });

        // Fetch Users
        const usersRef = collection(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME);
        const unsubUsers = onSnapshot(usersRef, (querySnapshot) => {
            const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setUsers(usersData);
            // Initialize local notes state from fetched user data
            const initialNotes = {};
            usersData.forEach(user => {
                initialNotes[user.id] = user.userInfo?.notes || '';
            });
            setUserNotes(initialNotes);
            setIsLoadingUsers(false);
        }, (error) => {
            console.error("Error fetching users:", error);
            setIsLoadingUsers(false);
            setModal({ isOpen: true, type: 'alert', message: 'Could not fetch user data.' });
        });

        return () => {
            unsubCoupons();
            unsubUsers();
        };
    }, [db, setModal]);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setNewCoupon(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleAddCoupon = async (e) => {
        e.preventDefault();
        if (!db || !newCoupon.code || !newCoupon.discountPercentage) {
            setModal({ isOpen: true, type: 'alert', message: 'Please fill all fields.' });
            return;
        }
        const couponId = newCoupon.code.trim().toUpperCase();
        const couponRef = doc(db, 'artifacts', appId, 'public', 'data', COUPONS_COLLECTION_NAME, couponId);
        
        try {
            await setDoc(couponRef, {
                discountPercentage: Number(newCoupon.discountPercentage),
                isActive: newCoupon.isActive,
                createdAt: new Date().toISOString()
            });
            setNewCoupon({ code: '', discountPercentage: 10, isActive: true });
        } catch (error) {
            console.error("Error adding coupon:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Failed to add coupon.' });
        }
    };

    const toggleCouponStatus = async (coupon) => {
        if (!db) return;
        const couponRef = doc(db, 'artifacts', appId, 'public', 'data', COUPONS_COLLECTION_NAME, coupon.id);
        try {
            await updateDoc(couponRef, { isActive: !coupon.isActive });
        } catch (error) {
            console.error("Error updating coupon status:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Failed to update coupon status.' });
        }
    };

    const handleDeleteCoupon = (couponId) => {
        if (!db) return;
        setModal({
            isOpen: true,
            type: 'confirm',
            message: `Are you sure you want to delete coupon ${couponId}?`,
            onConfirm: async () => {
                const couponRef = doc(db, 'artifacts', appId, 'public', 'data', COUPONS_COLLECTION_NAME, couponId);
                try {
                    await deleteDoc(couponRef);
                    setModal({ isOpen: false });
                } catch (error) {
                    console.error("Error deleting coupon:", error);
                    setModal({ isOpen: true, type: 'alert', message: 'Could not delete coupon.' });
                }
            }
        });
    };

    const handleUserTagChange = async (userId, newTag) => {
        const userRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, userId);
        try {
            await updateDoc(userRef, { "userInfo.tag": newTag });
        } catch (error) {
            console.error("Error updating user tag:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Failed to update user tag.' });
        }
    };

    const handleUserNotesChange = (userId, notes) => {
        setUserNotes(prev => ({ ...prev, [userId]: notes }));
    };

    const saveUserNotes = async (userId) => {
        const userRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, userId);
        try {
            await updateDoc(userRef, { "userInfo.notes": userNotes[userId] || '' });
            setModal({ isOpen: true, type: 'alert', message: 'Notes saved!' });
        } catch (error) {
            console.error("Error saving user notes:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Failed to save notes.' });
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="flex justify-between items-center mb-8">
                    <h1 className="text-2xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-amber-500">Admin Panel</h1>
                    <button onClick={() => setView('landing')} className="px-4 py-2 bg-gray-700 text-white font-bold rounded-lg hover:bg-gray-600 transition-colors">
                        &larr; Back to App
                    </button>
                </header>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* User Management Section */}
                    <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6 lg:col-span-3">
                        <h2 className="text-2xl font-bold text-teal-400 mb-4">User Accounts ({users.length})</h2>
                        {isLoadingUsers ? <p>Loading users...</p> : (
                            <div className="overflow-auto max-h-[600px]">
                                <table className="min-w-full text-sm">
                                    <thead className="sticky top-0 bg-gray-900/80 backdrop-blur-sm">
                                        <tr className="border-b border-gray-700 text-left text-xs uppercase text-gray-400">
                                            <th className="p-3">Access Code</th>
                                            <th className="p-3">Plan</th>
                                            <th className="p-3">Expiry</th>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">Tag</th>
                                            <th className="p-3">Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(user => {
                                            const isExpired = new Date().getTime() > user.userInfo.expiryDate;
                                            return (
                                                <tr key={user.id} className="border-b border-gray-800">
                                                    <td className="p-3 font-mono text-teal-300">{user.id}</td>
                                                    <td className="p-3 capitalize">{user.userInfo.plan}</td>
                                                    <td className="p-3">{new Date(user.userInfo.expiryDate).toLocaleDateString()}</td>
                                                    <td className="p-3">
                                                        <span className={`px-2 py-1 text-xs font-bold rounded-full ${!isExpired ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                            {!isExpired ? 'Active' : 'Expired'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3">
                                                        <select
                                                            value={user.userInfo.tag || ''}
                                                            onChange={(e) => handleUserTagChange(user.id, e.target.value)}
                                                            className="w-full p-1 bg-gray-800 border border-gray-600 rounded"
                                                        >
                                                            <option value="">- Select -</option>
                                                            {USER_TAGS.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                                                        </select>
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <textarea
                                                                value={userNotes[user.id] || ''}
                                                                onChange={(e) => handleUserNotesChange(user.id, e.target.value)}
                                                                className="w-full p-1 bg-gray-800 border border-gray-600 rounded text-xs"
                                                                rows="2"
                                                            />
                                                            <button onClick={() => saveUserNotes(user.id)} className="p-1 text-xs bg-teal-600 rounded hover:bg-teal-700">Save</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    
                    {/* Coupon Management Section */}
                    <div className="lg:col-span-3">
                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6 mb-8">
                            <h2 className="text-2xl font-bold text-teal-400 mb-4">Add New Coupon</h2>
                            <form onSubmit={handleAddCoupon} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div className="md:col-span-1">
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Coupon Code</label>
                                    <input type="text" name="code" value={newCoupon.code} onChange={handleInputChange} className="w-full p-2 bg-gray-800 border border-gray-600 rounded-lg" required />
                                </div>
                                 <div className="md:col-span-1">
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Discount (%)</label>
                                    <input type="number" name="discountPercentage" value={newCoupon.discountPercentage} onChange={handleInputChange} className="w-full p-2 bg-gray-800 border border-gray-600 rounded-lg" required min="1" max="100"/>
                                </div>
                                <div className="flex items-center justify-center h-full pb-2">
                                     <label className="flex items-center gap-2 text-gray-300">
                                        <input type="checkbox" name="isActive" checked={newCoupon.isActive} onChange={handleInputChange} className="h-5 w-5 rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500" />
                                        Active
                                    </label>
                                </div>
                                <button type="submit" className="w-full p-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-colors">Add Coupon</button>
                            </form>
                        </div>

                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
                             <h2 className="text-2xl font-bold text-teal-400 mb-4">Manage Coupons ({coupons.length})</h2>
                             {isLoadingCoupons ? <p>Loading coupons...</p> : (
                                 <div className="overflow-x-auto max-h-[400px]">
                                     <table className="min-w-full">
                                         <thead className="sticky top-0 bg-gray-900/80 backdrop-blur-sm">
                                             <tr className="border-b border-gray-700 text-left text-sm uppercase text-gray-400">
                                                 <th className="p-3">Code</th>
                                                 <th className="p-3">Discount</th>
                                                 <th className="p-3">Status</th>
                                                 <th className="p-3 text-right">Actions</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             {coupons.map(coupon => (
                                                 <tr key={coupon.id} className="border-b border-gray-800">
                                                     <td className="p-3 font-mono text-teal-300">{coupon.id}</td>
                                                     <td className="p-3">{coupon.discountPercentage}%</td>
                                                     <td className="p-3">
                                                         <span className={`px-2 py-1 text-xs font-bold rounded-full ${coupon.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                                                             {coupon.isActive ? 'Active' : 'Inactive'}
                                                         </span>
                                                     </td>
                                                     <td className="p-3 text-right space-x-2">
                                                         <button onClick={() => toggleCouponStatus(coupon)} className="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-500 hover:text-white transition-colors">Toggle</button>
                                                         <button onClick={() => handleDeleteCoupon(coupon.id)} className="px-3 py-1 text-xs font-semibold rounded-md bg-red-600/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors">Delete</button>
                                                     </td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const PaymentSuccessScreen = ({ details, setView }) => {
    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans">
            <div className="absolute inset-0 -z-10 h-full w-full bg-gray-950 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
            <div className="w-full max-w-lg text-center bg-gray-900/50 backdrop-blur-sm border border-teal-600 rounded-2xl shadow-2xl p-8 md:p-12">
                <div className="mx-auto mb-6 h-16 w-16 flex items-center justify-center rounded-full bg-green-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-300 to-emerald-500">Payment Successful!</h1>
                <p className="text-gray-300 mt-4 text-lg">Your account is now active. Welcome aboard!</p>
                <div className="my-8 p-4 bg-gray-800 border border-dashed border-gray-600 rounded-lg">
                    <p className="text-gray-400 text-sm mb-2">Your Secure Access Code is:</p>
                    <p className="text-3xl font-bold font-mono tracking-widest text-teal-300">{details.accessCode}</p>
                    <p className="text-xs text-amber-400 mt-3">Please save this code. You will need it to log in.</p>
                    {details.paymentAttemptId && (
                        <p className="text-xs text-gray-400 mt-4">Payment Reference: {details.paymentAttemptId}</p>
                    )}
                </div>
                <button onClick={() => setView('login')} className="w-full p-4 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition-all transform hover:scale-105">
                    Proceed to Login
                </button>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---
const App = () => {
    const [view, setView] = useState('landing'); // landing, login, userDetails, register, plans, dashboard, admin, admin-login, paymentSuccess
    const [viewHistory, setViewHistory] = useState([]);
    const [registrationDetails, setRegistrationDetails] = useState(null);
    const [paymentSuccessDetails, setPaymentSuccessDetails] = useState(null);
    const [allData, setAllData] = useState(null);
    const [loggedInCode, setLoggedInCode] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [modal, setModal] = useState({ isOpen: false, type: 'alert', message: '', onConfirm: null, defaultValues: null });
    const [notification, setNotification] = useState({ show: false, message: '' });
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isRenewalFlow, setIsRenewalFlow] = useState(false);
    const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [paymentAttemptId, setPaymentAttemptId] = useState(null);

    // Function to change view and manage history for back button
    const navigateTo = (newView) => {
        if (newView === 'admin' && !isAdminAuthenticated) {
             setViewHistory(prev => [...prev, view]);
             setView('admin-login');
             return;
        }
        setViewHistory(prev => [...prev, view]);
        setView(newView);
    };

    const goBack = () => {
        const previousView = viewHistory[viewHistory.length - 1];
        if (previousView) {
            setIsRenewalFlow(false); // Reset renewal flow on back navigation
            setViewHistory(prev => prev.slice(0, -1));
            setView(previousView);
        } else {
            setView('landing'); // Fallback to landing
        }
    };

    // Initialize Firebase and Auth
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(firestore);
            setAuth(authInstance);

            if (INITIAL_AUTH_TOKEN && INITIAL_AUTH_TOKEN.split('.').length === 3) {
                signInWithCustomToken(authInstance, INITIAL_AUTH_TOKEN).catch(error => { 
                    console.error("Custom token sign-in error:", error); 
                    signInAnonymously(authInstance); 
                });
            } else {
                signInAnonymously(authInstance);
            }
        } catch (error) {
            console.error("Firebase initialization error:", error);
            setModal({isOpen: true, type: 'alert', message: 'Could not connect to the database.'});
        }
    }, []);

    // Load external scripts
    useEffect(() => {
        const loadScript = (src, id) => {
            if (document.getElementById(id)) return;
            const script = document.createElement('script');
            script.id = id;
            script.src = src;
            script.async = true;
            document.body.appendChild(script);
        };
        loadScript('https://checkout.razorpay.com/v1/checkout.js', 'razorpay-checkout-js');
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js', 'tone-js-script');
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'html2canvas-js');
    }, []);

    // Listen for auth state changes and check local storage
    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, user => {
            if (user) {
                const savedCode = localStorage.getItem(SESSION_KEY);
                if (savedCode) {
                    setLoggedInCode(savedCode);
                    navigateTo('dashboard');
                } else {
                    setView('landing');
                }
            } else {
                setLoggedInCode(null);
                setView('landing');
                setViewHistory([]);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [auth]);

    // Data fetching and real-time updates from Firestore
    useEffect(() => {
        if (loggedInCode === '0000000000') {
            const sampleInitialCapital = 500000;
            const sampleJournal = { id: 'sample_journal_1', name: 'Test Strategy', initialCapital: sampleInitialCapital, createdAt: new Date().toISOString() };
            const sampleTrades = generateSampleTrades(125, sampleInitialCapital);
            const testUserData = {
                userInfo: { name: 'Test User (Expired)', plan: 'expired', expiryDate: new Date().getTime() - 1000, paymentHistory: [] },
                journals: [sampleJournal],
                trades: { 'sample_journal_1': sampleTrades }
            };
            setAllData(testUserData);
            setIsLoading(false);
            return; 
        }

        if (loggedInCode === '1111111111') {
            const sampleInitialCapital = 1000000;
            const sampleJournal = { id: 'sample_journal_2', name: 'Working Test Strategy', initialCapital: sampleInitialCapital, createdAt: new Date().toISOString() };
            const sampleTrades = generateSampleTrades(150, sampleInitialCapital);
            const testUserData = {
                userInfo: { name: 'Test User (Active)', plan: 'yearly', expiryDate: new Date().getTime() + 365 * 24 * 60 * 60 * 1000, paymentHistory: [{ paymentId: 'pay_sample', plan: 'yearly', amount: 49900, date: new Date().toISOString() }] },
                journals: [sampleJournal],
                trades: { 'sample_journal_2': sampleTrades }
            };
            setAllData(testUserData);
            setIsLoading(false);
            return;
        }

        if (!db || !loggedInCode) {
            if(!loggedInCode) setAllData(null);
            return;
        };
        
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, loggedInCode);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setAllData(docSnap.data());
            } else {
                setModal({isOpen: true, type: 'alert', message: 'Invalid Access Code.'});
                handleLogout();
            }
             setIsLoading(false);
        }, (error) => {
            console.error("Firestore snapshot error:", error);
            setModal({isOpen: true, type: 'alert', message: 'Error fetching data.'});
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [db, loggedInCode]);


    const updateData = async (newData) => {
        if (loggedInCode === '0000000000' || loggedInCode === '1111111111') {
            setAllData(newData);
            showSuccessNotification("Data updated in test session.");
            return;
        }
        if (!db || !loggedInCode) return;
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, loggedInCode);
        try {
            await setDoc(docRef, newData, { merge: true });
        } catch (error) {
            console.error("Error saving data to Firestore:", error);
            setModal({isOpen: true, type: 'alert', message: 'Could not save data.'});
        }
    };
    
    const handleLogin = async (code, password) => {
        if ((code === '0000000000' || code === '1111111111') && password === 'test') {
            localStorage.setItem(SESSION_KEY, code);
            setLoggedInCode(code);
            navigateTo('dashboard');
            return;
        }

        if (!db) {
            setModal({ isOpen: true, type: 'alert', message: 'Database connection not available. Please refresh and try again.' });
            return;
        }
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, code);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.userInfo.password === password) {
                    localStorage.setItem(SESSION_KEY, code);
                    setLoggedInCode(code);
                    navigateTo('dashboard');
                } else {
                    setModal({ isOpen: true, type: 'alert', message: 'Invalid password.' });
                }
            } else {
                setModal({ isOpen: true, type: 'alert', message: 'Invalid Access Code.' });
            }
        } catch (error) {
            console.error("Login error:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Could not verify credentials. Please try again.' });
        }
    };

    const handleLogout = () => {
        localStorage.removeItem(SESSION_KEY);
        setLoggedInCode(null);
        setIsRenewalFlow(false);
        setIsAdminAuthenticated(false);
        setView('landing');
        setViewHistory([]);
    };
    
    const showSuccessNotification = (message) => {
        if (window.Tone) { try { const synth = new window.Tone.Synth().toDestination(); synth.triggerAttackRelease("C5", "8n"); } catch (e) { console.error("Could not play sound:", e); } }
        setNotification({ show: true, message });
        setTimeout(() => setNotification({ show: false, message: '' }), 3000);
    };

    // --- [NEW] PAYMENT LOGIC (SERVER-SIDE) ---
    const handlePlanPayment = async (planType, amountInPaise) => {
        if (!window.Razorpay) {
            setModal({ isOpen: true, type: 'alert', message: 'Payment gateway is not ready. Please try again.' });
            return;
        }
        
        setIsProcessingPayment(true);
        const attemptId = `PTJ-receipt-${Date.now()}`;
        setPaymentAttemptId(attemptId);

        try {
            // Step 1: Ask your server to create an order
            const orderResponse = await fetch('/api/create-razorpay-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: amountInPaise,
                    currency: 'INR',
                    receipt: attemptId
                }),
            });

            if (!orderResponse.ok) {
                const errorData = await orderResponse.json();
                throw new Error(errorData.error || 'Failed to create payment order.');
            }

            const order = await orderResponse.json();

            // Step 2: Open Razorpay Checkout
            const options = {
                key: RAZORPAY_KEY_ID,
                amount: order.amount,
                currency: order.currency,
                name: "Pro Trader Journal",
                description: isRenewalFlow ? `Renew ${planType} Plan` : `Activate ${planType} Plan`,
                order_id: order.id,
                handler: async (response) => {
                    // Step 3: Verify the payment signature on your server
                    const verifyRes = await fetch('/api/verify-razorpay-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(response)
                    });
                    const verifyJson = await verifyRes.json();

                    if (verifyJson?.ok) {
                        // --- SERVER VERIFIED, NOW UPDATE DATABASE ---
                         try {
                            const newPaymentRecord = {
                                paymentId: response.razorpay_payment_id,
                                orderId: response.razorpay_order_id,
                                signature: response.razorpay_signature,
                                plan: planType,
                                amount: amountInPaise,
                                date: new Date().toISOString(),
                                attemptId: attemptId,
                            };

                            if (isRenewalFlow) {
                                const days = planType === 'monthly' ? 30 : 365;
                                const newExpiryDate = new Date().getTime() + days * 24 * 60 * 60 * 1000;
                                const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, loggedInCode);
                                
                                const docSnap = await getDoc(docRef);
                                if (!docSnap.exists()) throw new Error('User not found for renewal.');
                                
                                const existingData = docSnap.data();
                                const paymentHistory = existingData.userInfo.paymentHistory || [];
                                
                                await setDoc(docRef, { 
                                    userInfo: { 
                                        ...existingData.userInfo,
                                        plan: planType,
                                        expiryDate: newExpiryDate,
                                        paymentHistory: [...paymentHistory, newPaymentRecord]
                                    } 
                                }, { merge: true });

                                showSuccessNotification('Plan Renewed Successfully!');
                                setIsRenewalFlow(false);
                                setTimeout(() => navigateTo('dashboard'), 100);

                            } else {
                                const { name, email, mobile, accessCode, password } = registrationDetails;
                                const days = planType === 'monthly' ? 30 : 365;
                                const expiryDate = new Date().getTime() + days * 24 * 60 * 60 * 1000;
                                const initialData = { 
                                    userInfo: { 
                                        name, email, mobile, password,
                                        createdAt: new Date().toISOString(),
                                        plan: planType,
                                        expiryDate: expiryDate,
                                        paymentHistory: [newPaymentRecord],
                                        tag: 'New User',
                                        notes: ''
                                    }, 
                                    journals: [], 
                                    trades: {} 
                                };
                                const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, accessCode);
                                await setDoc(docRef, initialData);
                                setPaymentSuccessDetails({ accessCode: accessCode, paymentAttemptId: attemptId });
                                setTimeout(() => navigateTo('paymentSuccess'), 100);
                            }
                        } catch(error) {
                            console.error("DATABASE UPDATE ERROR:", error);
                            setModal({ isOpen: true, type: 'alert', message: `Payment was verified, but we couldn't update your account. Please contact support with Payment ID: ${response.razorpay_payment_id}` });
                        }
                    } else {
                        setModal({ isOpen: true, type: 'alert', message: 'Payment verification failed. Please contact support if the amount was debited.' });
                    }
                },
                prefill: {
                    name: registrationDetails?.name || allData?.userInfo?.name || '',
                    email: registrationDetails?.email || allData?.userInfo?.email || '',
                    contact: registrationDetails?.mobile || allData?.userInfo?.mobile || ''
                },
                notes: {
                    accessCode: isRenewalFlow ? loggedInCode : (registrationDetails ? registrationDetails.accessCode : 'N/A'),
                    payment_attempt_id: attemptId
                },
                theme: {
                    color: "#14b8a6"
                },
                modal: {
                    ondismiss: () => {
                        setModal({ isOpen: true, type: 'alert', message: `Payment window closed. Your transaction may not have been completed.` });
                    }
                }
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', function (response){
                console.error("Razorpay payment failed:", response.error);
                setModal({isOpen: true, type: 'alert', message: `Payment failed: ${response.error.description}. Please try another payment method.`});
            });
            rzp.open();

        } catch (error) {
            console.error("Error during payment process:", error);
            setModal({isOpen: true, type: 'alert', message: `Could not initiate payment: ${error.message}`});
        } finally {
            setIsProcessingPayment(false);
            setPaymentAttemptId(null);
        }
    };


    const handleStartRenewal = () => {
        setIsRenewalFlow(true);
        navigateTo('plans');
    };

    const handleModalClose = () => {
        if (modal.onConfirm && modal.type !== 'editTrade' && modal.type !== 'createJournal') {
             modal.onConfirm();
        } else {
             setModal({ isOpen: false });
        }
    };

    const handleAdminLogin = (password) => {
        setIsAuthLoading(true);
        setTimeout(() => {
            if (password === ADMIN_PASSWORD) {
                setIsAdminAuthenticated(true);
                navigateTo('admin');
            } else {
                setModal({ isOpen: true, type: 'alert', message: 'Incorrect password.' });
            }
            setIsAuthLoading(false);
        }, 100);
    };
    
    const renderView = () => {
        switch(view) {
            case 'landing': return <LandingPage setView={navigateTo} />;
            case 'userDetails': return <UserDetailsScreen setView={navigateTo} setRegistrationDetails={setRegistrationDetails} goBack={goBack} />;
            case 'register': return <RegisterScreen setView={navigateTo} setRegistrationDetails={setRegistrationDetails} db={db} setModal={setModal} goBack={goBack} />;
            case 'plans': return <PlansScreen onPlanSelect={handlePlanPayment} setModal={setModal} goBack={goBack} db={db} isProcessingPayment={isProcessingPayment} />;
            case 'dashboard': return <Dashboard allData={allData} updateData={updateData} userId={loggedInCode} onLogout={handleLogout} modal={modal} setModal={setModal} db={db} setView={navigateTo} handleStartRenewal={handleStartRenewal} />;
            case 'admin-login': return <AdminLogin onAdminLogin={handleAdminLogin} isLoading={isAuthLoading} setView={navigateTo} setModal={setModal} />;
            case 'admin': return isAdminAuthenticated ? <AdminPanel db={db} setView={navigateTo} setModal={setModal} /> : <AdminLogin onAdminLogin={handleAdminLogin} isLoading={isAuthLoading} setView={navigateTo} setModal={setModal} />;
            case 'paymentSuccess': return <PaymentSuccessScreen details={paymentSuccessDetails} setView={navigateTo} />;
            case 'login': default: return <LoginScreen onLogin={handleLogin} setModal={setModal} setView={navigateTo} db={db} />;
        }
    };

    const Notification = ({ message, show }) => {
        if (!show) return null;
        return (<div className="fixed top-5 right-5 bg-teal-500 text-white py-2 px-4 rounded-lg shadow-lg animate-fade-in-out z-50">{message}</div>);
    };

    const renderModalContent = () => {
        switch (modal.type) {
            case 'createJournal':
                return (<form onSubmit={modal.onConfirm}><h3 className="text-xl font-bold text-teal-400 mb-4">Create New Journal</h3><div className="space-y-4 text-left"><input type="text" name="name" placeholder="Journal Name" defaultValue={modal.defaultValues?.name} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /><input type="number" name="initialCapital" placeholder="Initial Capital (₹)" defaultValue={modal.defaultValues?.initialCapital} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex justify-center gap-4 mt-6"><button type="submit" className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">Create</button><button type="button" onClick={() => setModal({isOpen: false})} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button></div></form>);
            case 'editTrade':
                return (<form onSubmit={modal.onConfirm}><h3 className="text-xl font-bold text-teal-400 mb-4">Edit Record</h3><div className="space-y-4 text-left"><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Date</label><input type="date" name="date" defaultValue={modal.defaultValues?.date} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Gross P&L (₹)</label><input type="number" step="0.01" name="grossPnl" defaultValue={modal.defaultValues?.grossPnl} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Charges (₹)</label><input type="number" step="0.01" name="taxesAndCharges" defaultValue={modal.defaultValues?.taxesAndCharges} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Capital (₹)</label><input type="number" step="1" name="capitalDeployed" defaultValue={modal.defaultValues?.capitalDeployed} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Notes</label><textarea name="notes" defaultValue={modal.defaultValues?.notes} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" rows="2"></textarea></div></div><div className="flex justify-center gap-4 mt-6"><button type="submit" className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">Save</button><button type="button" onClick={() => setModal({isOpen: false})} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button></div></form>);
            default: // alert and confirm
                return (<><div className="text-lg text-gray-100 mb-6" style={{ whiteSpace: 'pre-wrap' }}>{modal.message}</div><div className="flex justify-center gap-4"><button onClick={() => { if (modal.onConfirm) { modal.onConfirm(); } else { setModal({isOpen: false}); } }} className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">OK</button>{modal.type === 'confirm' && <button onClick={() => setModal({isOpen: false})} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button>}</div></>);
        }
    };

    if (isLoading && !auth) {
        return <div className="min-h-screen bg-gray-950 flex justify-center items-center"><p className="text-teal-400 text-xl">Initializing...</p></div>;
    }

    return (
        <>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                body { font-family: 'Inter', sans-serif; }
                
                /* --- Global Fluidity & Transitions --- */
                * {
                    transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
                }
                button, select, input, textarea {
                     transition: all 0.15s ease-in-out;
                }

                .animate-fade-in-out { animation: fadeInOut 3s forwards; }
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateY(-20px); }
                    10% { opacity: 1; transform: translateY(0); }
                    90% { opacity: 1; transform: translateY(0); }
                    100% { opacity: 0; transform: translateY(-20px); }
                }
                .animate-scroll-up { animation: scroll-up 12.5s infinite; }
                @keyframes scroll-up {
                    0%, 8% { transform: translateY(0); }
                    10%, 28% { transform: translateY(-16.66%); }
                    30%, 48% { transform: translateY(-33.33%); }
                    50%, 68% { transform: translateY(-50%); }
                    70%, 88% { transform: translateY(-66.66%); }
                    90%, 100% { transform: translateY(-83.33%); }
                }
                
                .dashboard-container::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(20, 184, 166, 0.15), transparent 80%);
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.2s ease-out;
                }
                .dashboard-container:hover::before {
                    opacity: 1;
                }
                
                .section-header:hover svg {
                    transform: rotate(10deg) scale(1.1);
                }
                .section-header svg {
                    transition: transform 0.2s ease-in-out;
                }
                
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(15px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .fade-in-up { animation: fadeInUp 0.25s ease-out forwards; opacity: 0; }

                .feature-card {
                    opacity: 0;
                    transition: opacity 0.6s ease-out, transform 0.6s ease-out;
                }
                .feature-card.from-left { transform: translateX(-50px); }
                .feature-card.from-right { transform: translateX(50px); }
                .feature-card.is-visible {
                    opacity: 1;
                    transform: translateX(0);
                }
                
                .animate-ticker {
                    animation: ticker-scroll 60s linear infinite;
                }
                @keyframes ticker-scroll {
                    0% { transform: translateX(0%); }
                    100% { transform: translateX(-50%); }
                }

                @keyframes tilt {
                    0%, 100% { transform: rotate(0deg); }
                    50% { transform: rotate(0.5deg); }
                }
                .animate-tilt {
                    animation: tilt 10s ease-in-out infinite;
                }
                
                .bg-grid {
                    background-image: linear-gradient(to right, rgba(20, 184, 166, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(20, 184, 166, 0.1) 1px, transparent 1px);
                    background-size: 2rem 2rem;
                }
            `}</style>
            <div className="min-h-screen bg-gray-950">
                <Notification show={notification.show} message={notification.message} />
                {modal.isOpen && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
                        <div className="bg-gray-800 border border-teal-700 rounded-xl p-6 w-full max-w-md text-center shadow-2xl">
                            {renderModalContent()}
                        </div>
                    </div>
                )}
                {renderView()}
            </div>
        </>
    );
};

export default App;
