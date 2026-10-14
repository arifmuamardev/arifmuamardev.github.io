/* ----------------------------------------------------
   KU PhD Budget Dashboard - Application Logic (Vanilla JS)
   ---------------------------------------------------- */
window.addEventListener('error', function(e) {
    console.error('Dashboard error:', e.error || e.message);
    if (typeof showToast === 'function') showToast('Something went wrong. Please refresh if the issue continues.', 'error');
});

// --- Global Variables ---
let cashData = [];
let withdrawalsData = [];
let bniData = [];
let muamalatData = [];
let gopayData = [];
let activeFilters = {
    month: "all",
    category: "all",
    search: ""
};
let activePlatformFilter = "all";
let controlsInitialized = false;

// Chart.js Instances
let monthlyFlowChart = null;
let categoryPieChart = null;
let balanceTrendChart = null;
let incomeMonthlyChart = null;
let incomeCategoryChart = null;
let expenseMonthlyChart = null;
let expenseCategoryChart = null;
let bniTrendChart = null;
let bniTypeChart = null;
let muamalatTrendChart = null;
let muamalatTypeChart = null;
let gopayTrendChart = null;
let gopayTypeChart = null;
let spaylaterTrendChart = null;
let spaylaterCategoryChart = null;
let rentTrendChart = null;
let gasTrendChart = null;
let electricityTrendChart = null;
let waterTrendChart = null;
let utilitiesOverviewChart = null;
let mobileTrendChart = null;
let ecomPlatformChart = null;
let ecomTrendChart = null;

// Table sorting state
let currentSort = {
    column: "tanggal",
    direction: "desc"
};

// --- Helper Functions ---
function formatCurrency(value) {
    const numeric = Number(value) || 0;
    return new Intl.NumberFormat('ja-JP').format(Math.round(numeric));
}

function getExchangeRate() {
    return Number(window.BUDGET_CONFIG?.idrPerJpy || window.BUDGET_CLOUD_CONFIG?.exchangeRateFallback || 109.6);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\"', '&quot;')
        .replaceAll("'", '&#039;');
}

function showToast(message, type = 'info') {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = `app-toast ${type}`;
    const icon = document.createElement('i');
    icon.className = type === 'error' ? 'fa-solid fa-circle-exclamation' : type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-info';
    const text = document.createElement('span');
    text.textContent = String(message || '');
    toast.append(icon, text);
    stack.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
}

function isExcludedTransfer(itemNormalized) {
    return itemNormalized === 'Self-Transfer (Internal)' || 
           itemNormalized === 'Bank Inflow / Auto-Deposit' || 
           itemNormalized === 'Loan Repayment (Ryan)';
}

// Extract unique Year-Month values from transactions (sorted chronologically)
function getUniqueMonths(data) {
    const months = new Set();
    data.forEach(item => {
        if (item.tahun && item.bulan) {
            months.add(`${item.tahun}-${item.bulan}`);
        }
    });
    return Array.from(months);
}

// Extract unique categories from transactions (sorted alphabetically)
function getUniqueCategories(data) {
    const categories = new Set();
    data.forEach(item => {
        if (item.kategori_normalized && item.kategori_normalized !== "Others") {
            categories.add(item.kategori_normalized);
        }
    });
    const sorted = Array.from(categories).sort();
    if (sorted.includes("Others")) {
        const idx = sorted.indexOf("Others");
        sorted.splice(idx, 1);
    }
    sorted.push("Others"); 
    return sorted;
}

// --- Theme Toggle Logic ---
function initTheme() {
    const themeToggle = document.getElementById("theme-toggle");
    const savedTheme = localStorage.getItem("budget-theme") || "dark-theme";
    
    document.body.className = savedTheme;

    themeToggle.addEventListener("click", () => {
        if (document.body.classList.contains("dark-theme")) {
            document.body.className = "light-theme";
            localStorage.setItem("budget-theme", "light-theme");
        } else {
            document.body.className = "dark-theme";
            localStorage.setItem("budget-theme", "dark-theme");
        }
        // Redraw charts to update text color if theme changes
        updateCharts(getFilteredData());
        updateBniAccountView();
    });
}

// Get chart grid colors based on theme
function getChartColors() {
    const isDark = document.body.classList.contains("dark-theme");
    return {
        text: isDark ? "#94a3b8" : "#475569",
        grid: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
        tooltipBg: isDark ? "#1e293b" : "#ffffff",
        tooltipBorder: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.1)"
    };
}

// --- Data Filtering Logic ---
function getFilteredData() {
    return cashData.filter(item => {
        if (activeFilters.month !== "all") {
            const itemMonth = `${item.tahun}-${item.bulan}`;
            if (itemMonth !== activeFilters.month) return false;
        }
        if (activeFilters.category !== "all" && item.kategori_normalized !== activeFilters.category) return false;
        if (activeFilters.search) {
            const query = activeFilters.search.toLowerCase();
            const haystack = [item.item, item.item_normalized, item.tempat, item.kategori, item.kategori_normalized, item.note]
                .map(v => String(v ?? '').toLowerCase()).join(' ');
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
}

function getFilteredWithdrawals() {
    return withdrawalsData.filter(item => {
        // Month Filter
        if (activeFilters.month !== "all") {
            const itemMonth = `${item.tahun}-${item.bulan}`;
            if (itemMonth !== activeFilters.month) return false;
        }
        
        // Search Filter (check source)
        if (activeFilters.search) {
            const query = activeFilters.search.toLowerCase();
            const matchSource = item.source.toLowerCase().includes(query);
            if (!matchSource) return false;
        }
        
        return true;
    });
}

// --- UI Rendering ---

// Dynamic population of filters dropdown
function populateFilters(data) {
    const monthSelects = document.querySelectorAll(".sync-filter-month");
    const categorySelects = document.querySelectorAll(".sync-filter-category");
    
    // Clear dynamic options and populate month elements
    const months = getUniqueMonths(data);
    const monthOptions = [];
    monthOptions.push('<option value="all">All Months</option>');
    months.forEach(m => {
        const [year, name] = m.split("-");
        monthOptions.push(`<option value="${m}">${year} - ${name}</option>`);
    });
    const monthHTML = monthOptions.join("");
    monthSelects.forEach(select => {
        select.innerHTML = monthHTML;
        // Set active selection
        select.value = activeFilters.month || "all";
    });
    
    // Classify categories as Income or Expense
    const incomeCats = new Set();
    const expenseCats = new Set();
    
    data.forEach(item => {
        const cat = item.kategori_normalized;
        if (!cat) return;
        if (item.pemasukan > 0) {
            incomeCats.add(cat);
        }
        if (item.pengeluaran !== 0) {
            expenseCats.add(cat);
        }
    });

    const sortedIncome = Array.from(incomeCats).sort();
    const sortedExpense = Array.from(expenseCats).sort();

    // Reorder "Others" to the end of lists if present
    const pushOthersToEnd = (arr) => {
        if (arr.includes("Others")) {
            const idx = arr.indexOf("Others");
            arr.splice(idx, 1);
            arr.push("Others");
        }
        return arr;
    };
    pushOthersToEnd(sortedIncome);
    pushOthersToEnd(sortedExpense);
    
    // Build category options HTML
    const categoryOptions = [];
    categoryOptions.push('<option value="all">All Categories</option>');
    
    // Render Income Group
    if (sortedIncome.length > 0) {
        categoryOptions.push('<optgroup label="Income Categories">');
        sortedIncome.forEach(cat => {
            categoryOptions.push(`<option value="${cat}">${cat}</option>`);
        });
        categoryOptions.push('</optgroup>');
    }
    
    // Render Expense Group
    if (sortedExpense.length > 0) {
        categoryOptions.push('<optgroup label="Expense Categories">');
        sortedExpense.forEach(cat => {
            categoryOptions.push(`<option value="${cat}">${cat}</option>`);
        });
        categoryOptions.push('</optgroup>');
    }
    
    const categoryHTML = categoryOptions.join("");
    categorySelects.forEach(select => {
        select.innerHTML = categoryHTML;
        // Set active selection
        select.value = activeFilters.category || "all";
    });
}

// Update KPI Metrics Cards
function updateKPIs(filteredData) {
    let balanceVal = 0;
    let incomeVal = 0;
    let spendingVal = 0;
    
    if (filteredData.length > 0) {
        // Find the last item that has a valid cash balance
        const lastCashItem = [...filteredData].reverse().find(item => item.saldo !== null && item.saldo !== undefined);
        if (lastCashItem) {
            balanceVal = lastCashItem.saldo;
        } else {
            const lastGlobalCash = [...cashData].reverse().find(item => item.saldo !== null && item.saldo !== undefined);
            balanceVal = lastGlobalCash ? lastGlobalCash.saldo : 0;
        }
        
        filteredData.forEach(item => {
            if (!isExcludedTransfer(item.item_normalized)) {
                incomeVal += item.pemasukan;
                spendingVal += item.pengeluaran;
            }
        });
    } else {
        const lastGlobalCash = [...cashData].reverse().find(item => item.saldo !== null && item.saldo !== undefined);
        balanceVal = lastGlobalCash ? lastGlobalCash.saldo : 0;
    }
    
    // Savings rate calculation
    let savingsRate = 0;
    if (incomeVal > 0) {
        savingsRate = ((incomeVal - spendingVal) / incomeVal) * 100;
    } else if (spendingVal > 0) {
        savingsRate = -100.0;
    }

    // Populate UI
    document.getElementById("kpi-balance").textContent = formatCurrency(balanceVal);
    document.getElementById("kpi-income").textContent = formatCurrency(incomeVal);
    document.getElementById("kpi-spending").textContent = formatCurrency(spendingVal);
    
    const rateEl = document.getElementById("kpi-savings-rate");
    rateEl.textContent = savingsRate.toFixed(1);
    
    const rateCard = document.querySelector(".card-savings");
    if (savingsRate < 0) {
        rateCard.style.setProperty('--color-savings', 'var(--color-expense)');
        rateCard.style.setProperty('--color-savings-glow', 'var(--color-expense-glow)');
    } else {
        rateCard.style.setProperty('--color-savings', '#fbbf24');
        rateCard.style.setProperty('--color-savings-glow', 'rgba(251, 191, 36, 0.15)');
    }
}

// Home command center: current-month snapshot independent of historical filters.
function updateHomeCommandCenter() {
    const monthLabelEl = document.getElementById("home-period-label");
    const greetingEl = document.getElementById("home-greeting");
    const balanceEl = document.getElementById("home-current-balance");
    const balanceMetaEl = document.getElementById("home-balance-meta");
    const incomeEl = document.getElementById("home-month-income");
    const spendingEl = document.getElementById("home-month-spending");
    const netEl = document.getElementById("home-month-net");
    const savingsEl = document.getElementById("home-month-savings");
    const incomeNoteEl = document.getElementById("home-income-note");
    const spendingNoteEl = document.getElementById("home-spending-note");
    const alertsEl = document.getElementById("home-alerts");
    const recentEl = document.getElementById("home-recent-list");

    if (!monthLabelEl || !balanceEl || !alertsEl || !recentEl) return;

    const now = new Date();
    const tokyoParts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value])
    );
    const year = Number(tokyoParts.year);
    const month = Number(tokyoParts.month);
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
    const previousKey = `${previousMonthDate.getUTCFullYear()}-${String(previousMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;

    const monthLabel = new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "Asia/Tokyo"
    }).format(now);
    monthLabelEl.textContent = monthLabel;

    const hour = Number(new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: "Asia/Tokyo"
    }).format(now));
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    if (greetingEl) greetingEl.textContent = `${greeting}. Your money at a glance.`;

    const dateKey = item => String(item?.tanggal || "").slice(0, 7);
    const currentMonth = cashData.filter(item => dateKey(item) === monthKey);
    const currentDay = Number(tokyoParts.day);
    const previousMonth = cashData.filter(item =>
        dateKey(item) === previousKey &&
        Number(String(item?.tanggal || "").slice(8, 10)) <= currentDay
    );

    const summarize = rows => rows.reduce((acc, item) => {
        if (isExcludedTransfer(item.item_normalized)) return acc;
        acc.income += Number(item.pemasukan) || 0;
        acc.spending += Number(item.pengeluaran) || 0;
        if ((Number(item.pemasukan) || 0) > 0) acc.incomeEntries += 1;
        return acc;
    }, { income: 0, spending: 0, incomeEntries: 0 });

    const current = summarize(currentMonth);
    const previous = summarize(previousMonth);
    const net = current.income - current.spending;
    const savingsRate = current.income > 0
        ? (net / current.income) * 100
        : null;

    const latestBalanceItem = [...cashData].reverse().find(item =>
        item.saldo !== null && item.saldo !== undefined && Number.isFinite(Number(item.saldo))
    );
    const latestBalance = Number(latestBalanceItem?.saldo) || 0;
    balanceEl.textContent = formatCurrency(latestBalance);
    if (balanceMetaEl) {
        balanceMetaEl.textContent = latestBalanceItem?.tanggal
            ? `Latest balance recorded ${latestBalanceItem.tanggal}`
            : "No recorded balance yet";
    }

    if (incomeEl) incomeEl.textContent = `¥${formatCurrency(current.income)}`;
    if (spendingEl) spendingEl.textContent = `¥${formatCurrency(current.spending)}`;
    if (netEl) {
        netEl.textContent = `${net < 0 ? "−" : ""}¥${formatCurrency(Math.abs(net))}`;
        netEl.classList.toggle("income", net >= 0);
        netEl.classList.toggle("expense", net < 0);
    }
    if (savingsEl) {
        savingsEl.textContent = savingsRate === null ? "—" : `${savingsRate.toFixed(1)}%`;
        savingsEl.classList.toggle("income", savingsRate !== null && savingsRate >= 20);
        savingsEl.classList.toggle("expense", savingsRate !== null && savingsRate < 0);
    }
    if (incomeNoteEl) {
        incomeNoteEl.textContent = current.incomeEntries
            ? `${current.incomeEntries} income entr${current.incomeEntries === 1 ? "y" : "ies"} this month`
            : "No income recorded this month";
    }

    let spendingDelta = null;
    if (previous.spending > 0) {
        spendingDelta = ((current.spending - previous.spending) / previous.spending) * 100;
    }
    if (spendingNoteEl) {
        spendingNoteEl.textContent = spendingDelta === null
            ? "No prior-month baseline"
            : `${Math.abs(spendingDelta).toFixed(0)}% ${spendingDelta >= 0 ? "higher" : "lower"} vs same period last month`;
    }

    const alerts = [];
    if (currentMonth.length === 0) {
        alerts.push({
            type: "warning",
            icon: "fa-calendar-xmark",
            title: "No activity recorded this month",
            text: "Check whether the latest transactions have been imported."
        });
    }

    if (current.income === 0 && currentMonth.length > 0) {
        alerts.push({
            type: "",
            icon: "fa-coins",
            title: "No income recorded yet",
            text: "Savings rate will appear after this month's first income entry."
        });
    }

    if (spendingDelta !== null && spendingDelta >= 15) {
        alerts.push({
            type: "warning",
            icon: "fa-arrow-trend-up",
            title: "Spending is rising",
            text: `Spending is ${spendingDelta.toFixed(0)}% above the same period last month.`
        });
    } else if (spendingDelta !== null && spendingDelta <= -15) {
        alerts.push({
            type: "success",
            icon: "fa-arrow-trend-down",
            title: "Spending is lower",
            text: `Spending is ${Math.abs(spendingDelta).toFixed(0)}% below the same period last month.`
        });
    }

    if (current.income > 0 && savingsRate < 20) {
        alerts.push({
            type: savingsRate < 0 ? "warning" : "",
            icon: savingsRate < 0 ? "fa-triangle-exclamation" : "fa-piggy-bank",
            title: savingsRate < 0 ? "Monthly outflow exceeds income" : "Savings rate below 20%",
            text: savingsRate < 0
                ? "Review large or discretionary expenses before month end."
                : `Current savings rate is ${savingsRate.toFixed(1)}%.`
        });
    } else if (current.income > 0 && savingsRate >= 20) {
        alerts.push({
            type: "success",
            icon: "fa-circle-check",
            title: "Savings pace looks healthy",
            text: `Current savings rate is ${savingsRate.toFixed(1)}%.`
        });
    }

    const latestTxn = [...cashData].reverse().find(item => item.tanggal);
    if (latestTxn?.tanggal) {
        const latestDate = new Date(`${latestTxn.tanggal}T00:00:00+09:00`);
        const daysOld = Math.floor((now.getTime() - latestDate.getTime()) / 86400000);
        if (daysOld > 7) {
            alerts.push({
                type: "warning",
                icon: "fa-clock-rotate-left",
                title: "Data may need a refresh",
                text: `Latest recorded transaction is ${daysOld} days old.`
            });
        }
    }

    if (!alerts.length) {
        alerts.push({
            type: "success",
            icon: "fa-circle-check",
            title: "Nothing urgent detected",
            text: "Current month signals look stable."
        });
    }

    alertsEl.innerHTML = alerts.slice(0, 3).map(alert => `
        <div class="home-alert ${alert.type || ""}">
            <span class="home-alert-icon"><i class="fa-solid ${alert.icon}"></i></span>
            <div><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.text)}</p></div>
        </div>
    `).join("");

    const recent = [...cashData]
        .sort((a, b) => String(b.tanggal || "").localeCompare(String(a.tanggal || "")) || Number(b.id || 0) - Number(a.id || 0))
        .slice(0, 5);

    if (!recent.length) {
        recentEl.innerHTML = '<div class="home-empty-state">No transactions yet.</div>';
        return;
    }

    recentEl.innerHTML = recent.map(item => {
        const income = Number(item.pemasukan) || 0;
        const expense = Number(item.pengeluaran) || 0;
        const isIncome = income > 0;
        const amount = isIncome ? income : expense;
        const amountText = amount
            ? `${isIncome ? "+" : expense < 0 ? "+" : "−"}¥${formatCurrency(Math.abs(amount))}`
            : "—";
        const amountClass = isIncome || expense < 0 ? "income" : (expense > 0 ? "expense" : "");
        const icon = isIncome ? "fa-arrow-down" : (expense ? "fa-arrow-up" : "fa-right-left");
        const label = item.item_normalized || item.item || "Transaction";
        const meta = [item.tanggal, item.kategori_normalized || item.kategori, item.tempat].filter(Boolean).join(" · ");
        return `
            <div class="home-recent-item">
                <span class="home-recent-icon"><i class="fa-solid ${icon}"></i></span>
                <span class="home-recent-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(meta)}</small></span>
                <span class="home-recent-amount ${amountClass}">${amountText}</span>
            </div>
        `;
    }).join("");
}

// Helper to render styled category badges with distinct colors and FontAwesome icons
function getCategoryBadgeHtml(kategori) {
    if (!kategori) return '';
    
    let icon = 'fa-ellipsis';
    let cls = 'others';
    
    const cat = kategori.trim();
    const catLower = cat.toLowerCase();
    
    if (catLower === 'apartment') {
        icon = 'fa-building';
        cls = 'apartment';
    } else if (catLower === 'electricity') {
        icon = 'fa-bolt';
        cls = 'electricity';
    } else if (catLower === 'water') {
        icon = 'fa-droplet';
        cls = 'water';
    } else if (catLower === 'gas') {
        icon = 'fa-fire';
        cls = 'gas';
    } else if (catLower === 'food & dining') {
        icon = 'fa-utensils';
        cls = 'food';
    } else if (catLower === 'transportation') {
        icon = 'fa-bus';
        cls = 'transportation';
    } else if (catLower === 'internet') {
        icon = 'fa-wifi';
        cls = 'internet';
    } else if (catLower === 'software/service') {
        icon = 'fa-laptop-code';
        cls = 'software';
    } else if (catLower === 'entertainment') {
        icon = 'fa-film';
        cls = 'entertainment';
    } else if (catLower === 'insurance') {
        icon = 'fa-shield-halved';
        cls = 'insurance';
    } else if (catLower === 'taxes & fees') {
        icon = 'fa-receipt';
        cls = 'taxes';
    } else if (catLower === 'stationery') {
        icon = 'fa-pen-nib';
        cls = 'stationery';
    } else if (catLower === 'household supplies') {
        icon = 'fa-soap';
        cls = 'household';
    } else if (catLower === 'donations & charity') {
        icon = 'fa-heart';
        cls = 'donations';
    } else if (catLower === 'clothing & apparel') {
        icon = 'fa-shirt';
        cls = 'clothing';
    } else if (catLower === 'scholarship income') {
        icon = 'fa-graduation-cap';
        cls = 'scholarship';
    } else if (catLower === 'part-time job income') {
        icon = 'fa-briefcase';
        cls = 'job';
    } else if (catLower === 'gifts & souvenirs') {
        icon = 'fa-gift';
        cls = 'gifts';
    }
    
    return `<span class="badge badge-category badge-cat-${cls}"><i class="fa-solid ${icon}" style="margin-right: 0.35rem; font-size: 0.85em;"></i>${escapeHtml(cat)}</span>`;
}

// Helper to return distinct and consistent solid hex colors for Chart.js matching the badge categories
function getCategoryColor(categoryName) {
    const name = (categoryName || '').toLowerCase().trim();
    if (name === 'apartment') return '#ef4444';
    if (name === 'electricity') return '#f59e0b';
    if (name === 'water') return '#3b82f6';
    if (name === 'gas') return '#f97316';
    if (name === 'food & dining') return '#10b981';
    if (name === 'transportation') return '#6366f1';
    if (name === 'internet') return '#0ea5e9';
    if (name === 'software/service') return '#8b5cf6';
    if (name === 'entertainment') return '#ec4899';
    if (name === 'insurance') return '#14b8a6';
    if (name === 'taxes & fees') return '#94a3b8';
    if (name === 'stationery') return '#84cc16';
    if (name === 'household supplies') return '#06b6d4';
    if (name === 'donations & charity') return '#f43f5e';
    if (name === 'clothing & apparel') return '#d946ef';
    if (name === 'scholarship income') return '#10b981';
    if (name === 'part-time job income') return '#14b8a6';
    if (name === 'gifts & souvenirs') return '#e11d48';
    return '#64748b'; // others / default
}

// Render the Ledger Table rows
function updateLedgerTable(filteredData) {
    const tableBody = document.getElementById("ledger-table-body");
    const countEl = document.getElementById("transaction-count");
    
    tableBody.innerHTML = "";
    countEl.textContent = `Showing ${filteredData.length} transactions`;

    if (filteredData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">No transactions matching current filters.</td></tr>`;
        return;
    }

    // Sort the filtered data based on currentSort state
    const sortedData = [...filteredData].sort((a, b) => {
        let valA = a[currentSort.column];
        let valB = b[currentSort.column];

        // String comparison case-insensitive
        if (typeof valA === "string") {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return currentSort.direction === "asc" ? -1 : 1;
        if (valA > valB) return currentSort.direction === "asc" ? 1 : -1;
        return 0;
    });

    sortedData.forEach(item => {
        const row = document.createElement("tr");
        
        const isTransfer = isExcludedTransfer(item.item_normalized);
        
        let incomeTd = "-";
        let expenseTd = "-";
        
        if (item.pemasukan > 0) {
            if (isTransfer) {
                incomeTd = `<span class="badge badge-transfer">⇄ ¥${formatCurrency(item.pemasukan)}</span>`;
            } else {
                incomeTd = `<span class="badge badge-income">+ ¥${formatCurrency(item.pemasukan)}</span>`;
            }
        }
        
        if (item.pengeluaran !== 0 && item.pengeluaran !== null && item.pengeluaran !== undefined) {
            if (isTransfer) {
                expenseTd = `<span class="badge badge-transfer">⇄ ¥${formatCurrency(item.pengeluaran)}</span>`;
            } else if (item.pengeluaran < 0) {
                expenseTd = `<span class="badge badge-income" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25);">+ ¥${formatCurrency(Math.abs(item.pengeluaran))}</span>`;
            } else {
                expenseTd = `<span class="badge badge-expense">- ¥${formatCurrency(item.pengeluaran)}</span>`;
            }
        }

        const typeBadge = item.payment_type === 'cash' 
            ? `<span class="badge badge-type-cash" style="font-size: 0.65rem; padding: 0.1rem 0.35rem; margin-right: 0.5rem;"><i class="fa-solid fa-money-bill-1"></i> Cash</span>`
            : `<span class="badge badge-type-cashless" style="font-size: 0.65rem; padding: 0.1rem 0.35rem; margin-right: 0.5rem;"><i class="fa-solid fa-credit-card"></i> Digital</span>`;
            
        let subtextHtml = '';
        if (item.item !== item.item_normalized) {
            subtextHtml += `<div class="table-subtext">${escapeHtml(item.item)}</div>`;
        }
        if (item.note) {
            subtextHtml += `<div class="table-subtext" style="color: var(--color-primary); font-style: italic; margin-top: 2px;"><i class="fa-solid fa-sticky-note"></i> ${escapeHtml(item.note)}</div>`;
        }

        const saldoTd = (item.saldo !== null && item.saldo !== undefined && item.payment_type !== 'cashless')
            ? `¥${formatCurrency(item.saldo)}`
            : `<span style="color: var(--text-muted); font-style: italic; font-weight: 400;">-</span>`;
            
        row.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
            <td style="white-space: nowrap;">${item.tanggal}</td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item_normalized)}</div>
                ${subtextHtml}
            </td>
            <td>
                ${getCategoryBadgeHtml(item.kategori_normalized)}
                <div style="margin-top: 4px;">${typeBadge}</div>
            </td>
            <td>${item.tempat ? escapeHtml(item.tempat) : '<span style="color: var(--text-muted); font-style: italic;">N/A</span>'}</td>
            <td class="amount-col">${incomeTd}</td>
            <td class="amount-col">${expenseTd}</td>
            <td class="amount-col" style="font-weight: 600; color: var(--text-primary);">${saldoTd}</td>
        `;
        tableBody.appendChild(row);
    });
}

// Render the ATM Withdrawals tab view
function updateWithdrawalsTab(filteredW) {
    const tableBody = document.getElementById("withdrawals-table-body");
    const countEl = document.getElementById("withdrawal-count");
    
    tableBody.innerHTML = "";
    countEl.textContent = `Showing ${filteredW.length} transactions`;

    let totalWithdrawn = 0;
    let totalDeposited = 0;
    let totalFees = 0;

    const kpiWTotalEl = document.getElementById("kpi-w-total");
    const kpiDTotalEl = document.getElementById("kpi-d-total");
    const kpiWFeesEl = document.getElementById("kpi-w-fees");

    if (filteredW.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No ATM transactions matching current filters.</td></tr>`;
        if (kpiWTotalEl) kpiWTotalEl.textContent = "0";
        if (kpiDTotalEl) kpiDTotalEl.textContent = "0";
        if (kpiWFeesEl) kpiWFeesEl.textContent = "0";
        return;
    }

    // Sort newest transactions at the top
    const sortedW = [...filteredW].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    sortedW.forEach(item => {
        const itemType = item.type || "withdrawal";
        totalFees += item.fee;
        
        if (itemType === "withdrawal") {
            totalWithdrawn += item.amount;
        } else {
            totalDeposited += item.amount;
        }
        
        const row = document.createElement("tr");
        
        let typeBadge = "";
        let netImpact = 0;
        let netImpactHtml = "";
        
        if (itemType === "withdrawal") {
            typeBadge = `<span class="badge badge-expense" style="font-size: 0.7rem; padding: 0.15rem 0.4rem; white-space: nowrap;"><i class="fa-solid fa-arrow-down-long"></i> Withdrawal</span>`;
            netImpact = item.amount + item.fee;
            netImpactHtml = `<span style="font-weight: 600; color: var(--color-expense);">- ¥${formatCurrency(netImpact)}</span>`;
        } else {
            typeBadge = `<span class="badge badge-income" style="font-size: 0.7rem; padding: 0.15rem 0.4rem; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); white-space: nowrap;"><i class="fa-solid fa-arrow-up-long"></i> Deposit</span>`;
            netImpact = item.amount - item.fee;
            netImpactHtml = `<span style="font-weight: 600; color: #10b981;">+ ¥${formatCurrency(netImpact)}</span>`;
        }
        
        row.innerHTML = `
            <td>${item.no}</td>
            <td style="white-space: nowrap;">${item.tanggal}</td>
            <td>${typeBadge}</td>
            <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.source)}</td>
            <td class="amount-col">¥${formatCurrency(item.amount)}</td>
            <td class="amount-col">${item.fee > 0 ? `¥${formatCurrency(item.fee)}` : '-'}</td>
            <td class="amount-col">${netImpactHtml}</td>
        `;
        tableBody.appendChild(row);
    });

    if (kpiWTotalEl) kpiWTotalEl.textContent = formatCurrency(totalWithdrawn);
    if (kpiDTotalEl) kpiDTotalEl.textContent = formatCurrency(totalDeposited);
    if (kpiWFeesEl) kpiWFeesEl.textContent = formatCurrency(totalFees);
}

// --- Charts Rendering (Chart.js) ---

function updateCharts(filteredData) {
    const colors = getChartColors();
    
    // 1. Chart 1: Monthly Cash Flow (Income vs Expense)
    renderMonthlyFlowChart(filteredData, colors);
    
    // 2. Chart 2: Expense by Category (Doughnut)
    renderCategoryPieChart(filteredData, colors);
    
    // 3. Chart 3: Cumulative Balance Trend (Line)
    renderBalanceTrendChart(filteredData, colors);
}

function renderMonthlyFlowChart(filteredData, colors) {
    if (monthlyFlowChart) {
        monthlyFlowChart.destroy();
    }

    // Group by Month
    const monthlySummary = {};
    filteredData.forEach(item => {
        const key = `${item.tahun}-${item.bulan}`;
        if (!monthlySummary[key]) {
            monthlySummary[key] = { income: 0, expense: 0 };
        }
        if (!isExcludedTransfer(item.item_normalized)) {
            monthlySummary[key].income += item.pemasukan;
            monthlySummary[key].expense += item.pengeluaran;
        }
    });

    const labels = Object.keys(monthlySummary);
    const incomes = labels.map(l => monthlySummary[l].income);
    const expenses = labels.map(l => monthlySummary[l].expense);
    
    const formattedLabels = labels.map(l => {
        const [year, month] = l.split("-");
        return `${month.substring(0,3)} ${year}`;
    });

    const ctx = document.getElementById("monthly-flow-chart").getContext("2d");
    monthlyFlowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: formattedLabels,
            datasets: [
                {
                    label: 'Income (Pemasukan)',
                    data: incomes,
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                    borderWidth: 0,
                    barPercentage: 0.6,
                    categoryPercentage: 0.5
                },
                {
                    label: 'Expense (Pengeluaran)',
                    data: expenses,
                    backgroundColor: '#f87171',
                    borderRadius: 6,
                    borderWidth: 0,
                    barPercentage: 0.6,
                    categoryPercentage: 0.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: colors.text, font: { family: 'Inter', weight: '500' } }
                },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.text, font: { family: 'Inter' } }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { 
                        color: colors.text, 
                        font: { family: 'Inter' },
                        callback: function(value) {
                            return '¥' + formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

function renderCategoryPieChart(filteredData, colors) {
    if (categoryPieChart) {
        categoryPieChart.destroy();
    }

    // Group expenses by category
    const categoriesSum = {};
    filteredData.forEach(item => {
        if (item.pengeluaran !== 0) {
            if (!isExcludedTransfer(item.item_normalized)) {
                categoriesSum[item.kategori_normalized] = (categoriesSum[item.kategori_normalized] || 0) + item.pengeluaran;
            }
        }
    });

    const sortedCategories = Object.entries(categoriesSum)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8); // top 8 categories

    const labels = sortedCategories.map(c => c[0]);
    const data = sortedCategories.map(c => c[1]);

    const ctx = document.getElementById("category-pie-chart").getContext("2d");
    categoryPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels.map(label => getCategoryColor(label)),
                borderWidth: document.body.classList.contains("dark-theme") ? 2 : 1,
                borderColor: document.body.classList.contains("dark-theme") ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: colors.text, font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const val = context.raw;
                            const pct = ((val / total) * 100).toFixed(1);
                            return ` ${context.label}: ¥${formatCurrency(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderBalanceTrendChart(filteredData, colors) {
    if (balanceTrendChart) {
        balanceTrendChart.destroy();
    }

    // Filter out transactions that do not have a cash balance (like cashless digital purchases)
    const trendData = filteredData.filter(item => item.saldo !== null && item.saldo !== undefined);

    const labels = trendData.map(item => item.tanggal);
    const balances = trendData.map(item => item.saldo);

    const ctx = document.getElementById("balance-trend-chart").getContext("2d");
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.00)');

    balanceTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Running Balance (Saldo)',
                data: balances,
                borderColor: '#6366f1',
                borderWidth: 3,
                fill: true,
                backgroundColor: gradient,
                tension: 0.35,
                pointRadius: labels.length > 50 ? 0 : 2,
                pointHoverRadius: 6,
                pointBackgroundColor: '#6366f1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` Balance: ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { 
                        color: colors.text, 
                        font: { family: 'Inter' },
                        maxTicksLimit: 12
                    }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { 
                        color: colors.text, 
                        font: { family: 'Inter' },
                        callback: function(value) {
                            return '¥' + formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

// --- Event Listeners Setup ---
function setupFilters() {
    const monthSelects = document.querySelectorAll(".sync-filter-month");
    const categorySelects = document.querySelectorAll(".sync-filter-category");
    const searchInputs = document.querySelectorAll(".sync-filter-search");
    const resetBtns = document.querySelectorAll(".sync-filter-reset");

    // Add change listeners to month selects
    monthSelects.forEach(select => {
        select.addEventListener("change", (e) => {
            const val = e.target.value;
            activeFilters.month = val;
            
            // Sync all other month selects
            monthSelects.forEach(s => {
                if (s.value !== val) s.value = val;
            });
            
            // Reset sort headers on all dynamic tables
            resetTableSortHeaders("ledger-table");
            resetTableSortHeaders("income-table");
            resetTableSortHeaders("expense-table");
            resetTableSortHeaders("withdrawals-table");
            resetTableSortHeaders("rent-table");
            resetTableSortHeaders("gas-table");
            resetTableSortHeaders("electricity-table");
            resetTableSortHeaders("water-table");
            resetTableSortHeaders("ecom-table");
            
            const filtered = getFilteredData();
            const filteredW = getFilteredWithdrawals();
            updateKPIs(filtered);
            updateLedgerTable(filtered);
            updateCharts(filtered);
            updateWithdrawalsTab(filteredW);
            updateIncomePage(filtered);
            updateExpensePage(filtered);
            updateUtilityPages(filtered);
            updateOnlineShoppingPage(filtered);
        });
    });

    // Add change listeners to category selects
    categorySelects.forEach(select => {
        select.addEventListener("change", (e) => {
            const val = e.target.value;
            activeFilters.category = val;
            
            // Sync all other category selects
            categorySelects.forEach(s => {
                if (s.value !== val) s.value = val;
            });
            
            // Reset sort headers on dynamic tables that support category filtering
            resetTableSortHeaders("ledger-table");
            resetTableSortHeaders("income-table");
            resetTableSortHeaders("expense-table");
            resetTableSortHeaders("ecom-table");
            
            const filtered = getFilteredData();
            updateKPIs(filtered);
            updateLedgerTable(filtered);
            updateCharts(filtered);
            updateIncomePage(filtered);
            updateExpensePage(filtered);
            updateUtilityPages(filtered);
            updateOnlineShoppingPage(filtered);
        });
    });

    // Add input listeners to search inputs
    searchInputs.forEach(input => {
        input.addEventListener("input", (e) => {
            const val = e.target.value;
            activeFilters.search = val;
            
            // Sync all other search inputs
            searchInputs.forEach(s => {
                if (s.value !== val) s.value = val;
            });
            
            // Reset sort headers
            resetTableSortHeaders("ledger-table");
            resetTableSortHeaders("income-table");
            resetTableSortHeaders("expense-table");
            resetTableSortHeaders("withdrawals-table");
            resetTableSortHeaders("rent-table");
            resetTableSortHeaders("gas-table");
            resetTableSortHeaders("electricity-table");
            resetTableSortHeaders("water-table");
            resetTableSortHeaders("ecom-table");
            
            const filtered = getFilteredData();
            const filteredW = getFilteredWithdrawals();
            updateKPIs(filtered);
            updateLedgerTable(filtered);
            updateCharts(filtered);
            updateWithdrawalsTab(filteredW);
            updateIncomePage(filtered);
            updateExpensePage(filtered);
            updateUtilityPages(filtered);
            updateOnlineShoppingPage(filtered);
        });
    });

    // Add click listeners to reset buttons
    resetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            activeFilters.month = "all";
            activeFilters.category = "all";
            activeFilters.search = "";
            activePlatformFilter = "all";
            
            // Reset values visually
            monthSelects.forEach(s => s.value = "all");
            categorySelects.forEach(s => s.value = "all");
            searchInputs.forEach(s => s.value = "");
            const platformSelect = document.querySelector(".sync-filter-platform");
            if (platformSelect) platformSelect.value = "all";
            
            // Reset sort headers
            resetTableSortHeaders("ledger-table");
            resetTableSortHeaders("income-table");
            resetTableSortHeaders("expense-table");
            resetTableSortHeaders("withdrawals-table");
            resetTableSortHeaders("rent-table");
            resetTableSortHeaders("gas-table");
            resetTableSortHeaders("electricity-table");
            resetTableSortHeaders("water-table");
            resetTableSortHeaders("ecom-table");
            
            const filtered = getFilteredData();
            const filteredW = getFilteredWithdrawals();
            updateKPIs(filtered);
            updateLedgerTable(filtered);
            updateCharts(filtered);
            updateWithdrawalsTab(filteredW);
            updateIncomePage(filtered);
            updateExpensePage(filtered);
            updateUtilityPages(filtered);
            updateOnlineShoppingPage(filtered);
        });
    });

    // Add change listener to platform select
    const platformSelect = document.querySelector(".sync-filter-platform");
    if (platformSelect) {
        platformSelect.addEventListener("change", (e) => {
            activePlatformFilter = e.target.value;
            resetTableSortHeaders("ecom-table");
            const filtered = getFilteredData();
            updateOnlineShoppingPage(filtered);
        });
    }
}

// --- Table Sorting Setup ---
function makeTableSortable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const headers = table.querySelectorAll("thead th");
    
    headers.forEach((header, index) => {
        // Add sortable class and pointer cursor
        header.classList.add("sortable");
        header.style.cursor = "pointer";
        
        // Ensure sort icon exists
        let icon = header.querySelector(".sort-icon");        if (!icon) {
            icon = document.createElement("i");
            icon.className = "fa-solid fa-sort sort-icon";
            icon.style.marginLeft = "0.5rem";
            icon.style.opacity = "0.5";
            header.appendChild(icon);
        }
        
        header.addEventListener("click", () => {
            const tbody = table.querySelector("tbody");
            if (!tbody) return;
            const rows = Array.from(tbody.querySelectorAll("tr"));
            if (rows.length === 0) return;
            
            const isAsc = header.classList.contains("sort-asc");
            
            // Clear sorting classes from other headers in this table
            headers.forEach(h => {
                h.classList.remove("sort-asc", "sort-desc", "active");
                const i = h.querySelector(".sort-icon");
                if (i) {
                    i.className = "fa-solid fa-sort sort-icon";
                    i.style.opacity = "0.5";
                }
            });
            
            const direction = isAsc ? -1 : 1;
            header.classList.add(isAsc ? "sort-desc" : "sort-asc");
            header.classList.add("active");
            icon.className = isAsc ? "fa-solid fa-sort-down sort-icon" : "fa-solid fa-sort-up sort-icon";
            icon.style.opacity = "1";
            
            // Sort rows
            rows.sort((rowA, rowB) => {
                const cellA = rowA.children[index]?.textContent.trim() || "";
                const cellB = rowB.children[index]?.textContent.trim() || "";
                
                // Helper to clean values for numeric comparisons
                const cleanNum = (str) => {
                    const clean = str.replace(/[^0-9\.\,\-]/g, '').replace(/,/g, '');
                    if (clean.includes('.') && clean.includes(',')) {
                        return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
                    } else if (clean.includes(',')) {
                        return parseFloat(clean.replace(/,/g, '.'));
                    }
                    return parseFloat(clean);
                };
                
                const numA = cleanNum(cellA);
                const numB = cleanNum(cellB);
                
                if (!isNaN(numA) && !isNaN(numB)) {
                    return (numA - numB) * direction;
                }
                
                // Check if date
                const dateA = Date.parse(cellA);
                const dateB = Date.parse(cellB);
                if (!isNaN(dateA) && !isNaN(dateB)) {
                    return (dateA - dateB) * direction;
                }
                
                return cellA.localeCompare(cellB, undefined, { numeric: true, sensitivity: 'base' }) * direction;
            });
            
            // Re-append rows in sorted order
            tbody.innerHTML = "";
            rows.forEach(r => tbody.appendChild(r));
        });
    });
}

function resetTableSortHeaders(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const headers = table.querySelectorAll("thead th");
    headers.forEach(h => {
        h.classList.remove("sort-asc", "sort-desc", "active");
        const icon = h.querySelector(".sort-icon");
        if (icon) {
            icon.className = "fa-solid fa-sort sort-icon";
            icon.style.opacity = "0.5";
        }
    });
}

function setupSorting() {
    const tableIds = [
        "ledger-table",
        "income-table",
        "expense-table",
        "withdrawals-table",
        "cc-ku-table",
        "toped-card-table",
        "bni-table",
        "muamalat-table",
        "gopay-table",
        "spaylater-table",
        "toped-installments-table",
        "spaylater-installments-table",
        "rent-table",
        "gas-table",
        "electricity-table",
        "water-table",
        "utilities-overview-table",
        "mobile-table",
        "ecom-table"
    ];
    tableIds.forEach(makeTableSortable);
}

// --- Fetch & Load Dataset ---
async function fetchAndInitData() {
    const syncEl = document.getElementById("sync-status");
    try {
        if (syncEl) syncEl.textContent = "Syncing…";
        const payload = await window.BudgetCloud.loadAll();
        cashData = payload.cash || [];
        withdrawalsData = payload.withdrawals || [];
        bniData = payload.bni || [];
        muamalatData = payload.muamalat || [];
        gopayData = payload.gopay || [];

        const settings = payload.settings || {};
        window.BUDGET_CONFIG = {
            idrPerJpy: Number(settings.idr_per_jpy || window.BUDGET_CLOUD_CONFIG?.exchangeRateFallback || 109.6),
            ccKuReconciliationStart: settings.cc_ku_reconciliation_start || "2026-05-16"
        };

        cashData.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || Number(a.id || 0) - Number(b.id || 0));

        populateFilters(cashData);
        if (!controlsInitialized) {
            setupFilters();
            setupSorting();
            controlsInitialized = true;
        }

        const filtered = getFilteredData();
        const filteredW = getFilteredWithdrawals();
        updateKPIs(filtered);
        updateHomeCommandCenter();
        updateLedgerTable(filtered);
        updateWithdrawalsTab(filteredW);
        updateCharts(filtered);
        initCCKuTracker();
        initTopedCardTracker();
        initBniAccountTracker();
        initMuamalatAccountTracker();
        initGoPayAccountTracker();
        initSPayLaterTracker();
        updateIncomePage(filtered);
        updateExpensePage(filtered);
        updateUtilityPages(filtered);
        updateOnlineShoppingPage(filtered);

        if (syncEl) syncEl.textContent = `Synced ${new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    } catch (error) {
        console.error("Failed to load secure finance data.", error);
        if (syncEl) syncEl.textContent = "Sync failed";
        showToast(error.message || "Could not load your financial data.", "error");
        throw error;
    }
}

// --- Navigation Tab Toggles ---
function initNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    const views = document.querySelectorAll(".dashboard-view");

    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetViewId = btn.getAttribute("data-target");
            localStorage.setItem("budget-last-view", targetViewId);
            history.replaceState(null, "", `#${targetViewId}`);
            document.body.classList.remove("sidebar-open");
            document.getElementById("sidebar-scrim")?.classList.add("hidden");

            navButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            btn.closest("details.sidebar-disclosure")?.setAttribute("open", "");

            // Update Top Bar Header dynamically
            const topBarTitle = document.querySelector(".welcome-text h2");
            const topBarDesc = document.querySelector(".welcome-text p");
            if (topBarTitle && topBarDesc) {
                if (targetViewId === "view-balance") {
                    topBarTitle.textContent = "Home";
                    topBarDesc.textContent = "Your current financial snapshot and recent activity";
                } else if (targetViewId === "view-analytics") {
                    topBarTitle.textContent = "Analytics & Charts";
                    topBarDesc.textContent = "Visual summaries, category allocations, and cash flows";
                } else if (targetViewId === "view-transactions") {
                    topBarTitle.textContent = "Transactions List";
                    topBarDesc.textContent = "Full history of cash and cashless transactions";
                } else if (targetViewId === "view-income") {
                    topBarTitle.textContent = "Income Analyzer";
                    topBarDesc.textContent = "Deep dive into scholarship and baito earnings";
                } else if (targetViewId === "view-expense") {
                    topBarTitle.textContent = "Expense Analyzer";
                    topBarDesc.textContent = "Detailed breakdown of monthly outlays and categories";
                } else if (targetViewId === "view-withdrawals") {
                    topBarTitle.textContent = "ATM Transactions";
                    topBarDesc.textContent = "Track cash withdrawals and ATM fees";
                } else if (targetViewId === "view-reconciliation") {
                    topBarTitle.textContent = "Account Reconciliation";
                    topBarDesc.textContent = "Align wallet cash, JP Bank, and Hokkoku Bank records";
                } else if (targetViewId === "view-bni-account") {
                    topBarTitle.textContent = "BNI Account Tracker";
                    topBarDesc.textContent = "IDR transactions and taplus savings";
                } else if (targetViewId === "view-muamalat-account") {
                    topBarTitle.textContent = "Bank Muamalat Tracker";
                    topBarDesc.textContent = "IDR savings and SMS banking transactions";
                } else if (targetViewId === "view-gopay-account") {
                    topBarTitle.textContent = "GoPay Wallet Tracker";
                    topBarDesc.textContent = "GoPay balance, coins, and transaction history";
                } else if (targetViewId === "view-cc-ku") {
                    topBarTitle.textContent = "CC KU Tracker";
                    topBarDesc.textContent = "Hokuriku VISA Card active statement and billing cycles";
                } else if (targetViewId === "view-toped-card") {
                    topBarTitle.textContent = "Tokopedia Card Tracker";
                    topBarDesc.textContent = "Tokopedia Card active billing and installments";
                } else if (targetViewId === "view-spaylater") {
                    topBarTitle.textContent = "SPayLater Tracker";
                    topBarDesc.textContent = "SPayLater active billings and monthly installments";
                } else if (targetViewId === "view-utilities-overview") {
                    topBarTitle.textContent = "Utilities Overview";
                    topBarDesc.textContent = "Combined utility tracker for rent, gas, electricity, and water";
                } else if (targetViewId === "view-rent") {
                    topBarTitle.textContent = "Apartment Rent";
                    topBarDesc.textContent = "Kanazawa monthly rent payment logs";
                } else if (targetViewId === "view-gas") {
                    topBarTitle.textContent = "Gas Tracker";
                    topBarDesc.textContent = "Monthly gas billing history and trend";
                } else if (targetViewId === "view-electricity") {
                    topBarTitle.textContent = "Electricity Tracker";
                    topBarDesc.textContent = "Monthly electricity billing history and trend";
                } else if (targetViewId === "view-water") {
                    topBarTitle.textContent = "Water Tracker";
                    topBarDesc.textContent = "Bi-monthly water billing history and trend";
                } else if (targetViewId === "view-mobile") {
                    topBarTitle.textContent = "Mobile Tracker";
                    topBarDesc.textContent = "Monthly phone billing history and trend";
                } else if (targetViewId === "view-ai-insights") {
                    topBarTitle.textContent = "Financial Advisor";
                    topBarDesc.textContent = "AI financial diagnostics and budget simulations";
                } else if (targetViewId === "view-online-shopping") {
                    topBarTitle.textContent = "Online Shopping Tracker";
                    topBarDesc.textContent = "Centralized dashboard for Amazon, Shopee, AliExpress, Temu, Tokopedia, and Booth purchases";
                }
            }

            views.forEach(view => {
                if (view.id === targetViewId) {
                    view.classList.remove("hidden");
                } else {
                    view.classList.add("hidden");
                }
            });

            if (targetViewId === "view-balance") {
                if (balanceTrendChart) balanceTrendChart.resize();
            } else if (targetViewId === "view-analytics") {
                if (monthlyFlowChart) monthlyFlowChart.resize();
                if (categoryPieChart) categoryPieChart.resize();
            } else if (targetViewId === "view-income") {
                if (incomeMonthlyChart) incomeMonthlyChart.resize();
                if (incomeCategoryChart) incomeCategoryChart.resize();
            } else if (targetViewId === "view-expense") {
                if (expenseMonthlyChart) expenseMonthlyChart.resize();
                if (expenseCategoryChart) expenseCategoryChart.resize();
            } else if (targetViewId === "view-reconciliation") {
                updateReconciliationView();
            } else if (targetViewId === "view-bni-account") {
                updateBniAccountView();
                if (bniTrendChart) bniTrendChart.resize();
                if (bniTypeChart) bniTypeChart.resize();
            } else if (targetViewId === "view-muamalat-account") {
                updateMuamalatAccountView();
                if (muamalatTrendChart) muamalatTrendChart.resize();
                if (muamalatTypeChart) muamalatTypeChart.resize();
            } else if (targetViewId === "view-gopay-account") {
                updateGoPayAccountView();
                if (gopayTrendChart) gopayTrendChart.resize();
                if (gopayTypeChart) gopayTypeChart.resize();
            } else if (targetViewId === "view-spaylater") {
                updateSPayLaterView();
                if (spaylaterTrendChart) spaylaterTrendChart.resize();
                if (spaylaterCategoryChart) spaylaterCategoryChart.resize();
            } else if (targetViewId === "view-utilities-overview") {
                if (utilitiesOverviewChart) utilitiesOverviewChart.resize();
            } else if (targetViewId === "view-rent") {
                if (rentTrendChart) rentTrendChart.resize();
            } else if (targetViewId === "view-gas") {
                if (gasTrendChart) gasTrendChart.resize();
            } else if (targetViewId === "view-electricity") {
                if (electricityTrendChart) electricityTrendChart.resize();
            } else if (targetViewId === "view-water") {
                if (waterTrendChart) waterTrendChart.resize();
            } else if (targetViewId === "view-mobile") {
                if (mobileTrendChart) mobileTrendChart.resize();
            } else if (targetViewId === "view-ai-insights") {
                updateSimulator();
            } else if (targetViewId === "view-online-shopping") {
                const filtered = getFilteredData();
                updateOnlineShoppingPage(filtered);
                if (ecomPlatformChart) ecomPlatformChart.resize();
                if (ecomTrendChart) ecomTrendChart.resize();
            }
        });
    });
}

// --- Balance Reconciliation View Logic ---
function updateReconciliationView() {
    const walletInput = document.getElementById("recon-wallet");
    const jpBankInput = document.getElementById("recon-jp-bank");
    const hokurikuBankInput = document.getElementById("recon-hokuriku-bank");
    
    if (!walletInput || !jpBankInput || !hokurikuBankInput) return;
    
    const walletVal = parseFloat(walletInput.value) || 0;
    const jpBankVal = parseFloat(jpBankInput.value) || 0;
    const hokurikuBankVal = parseFloat(hokurikuBankInput.value) || 0;
    
    const totalActual = walletVal + jpBankVal + hokurikuBankVal;
    
    // Sum JPY cashless CC KU transactions from the configured reconciliation start date
    let pendingBills = 0;
    cashData.forEach(item => {
        if (item.payment_type === 'cashless' && (item.note || '').includes('CC KU')) {
            if (item.tanggal >= (window.BUDGET_CONFIG?.ccKuReconciliationStart || '2026-05-16')) {
                pendingBills += item.pengeluaran;
            }
        }
    });
    
    const expectedNet = totalActual - pendingBills;
    
    // Current Dashboard Net Balance is the latest saldo in cashData
    const latestCash = [...cashData].reverse().find(item => item.saldo !== null && item.saldo !== undefined);
    const dashboardBal = latestCash ? latestCash.saldo : 0;
    
    const discrepancy = expectedNet - dashboardBal;
    
    // Format UI elements
    document.getElementById("calc-actual-funds").textContent = `¥${formatCurrency(totalActual)}`;
    document.getElementById("calc-pending-bills").textContent = `- ¥${formatCurrency(pendingBills)}`;
    document.getElementById("calc-expected-net").textContent = `¥${formatCurrency(expectedNet)}`;
    document.getElementById("calc-dashboard-balance").textContent = `¥${formatCurrency(dashboardBal)}`;
    
    const discrepancyEl = document.getElementById("calc-discrepancy");
    if (Math.abs(discrepancy) < 0.01) {
        discrepancyEl.textContent = "¥0";
        discrepancyEl.style.color = "#10b981"; // green
    } else if (discrepancy > 0) {
        discrepancyEl.textContent = `+ ¥${formatCurrency(discrepancy)}`;
        discrepancyEl.style.color = "#10b981"; // green
    } else {
        discrepancyEl.textContent = `- ¥${formatCurrency(Math.abs(discrepancy))}`;
        discrepancyEl.style.color = "var(--color-expense)"; // red
    }
}

function initReconciliation() {
    const btn = document.getElementById("btn-reconcile");
    const walletInput = document.getElementById("recon-wallet");
    const jpBankInput = document.getElementById("recon-jp-bank");
    const hokurikuBankInput = document.getElementById("recon-hokuriku-bank");
    
    if (!btn) return;
    
    const inputs = [walletInput, jpBankInput, hokurikuBankInput];
    inputs.forEach(input => {
        if (input) {
            input.addEventListener("input", updateReconciliationView);
        }
    });
    
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Reconciling...`;
        
        const walletVal = parseFloat(walletInput.value) || 0;
        const jpBankVal = parseFloat(jpBankInput.value) || 0;
        const hokurikuBankVal = parseFloat(hokurikuBankInput.value) || 0;
        
        try {
            const result = await window.BudgetCloud.reconcile({
                wallet: walletVal,
                jpBank: jpBankVal,
                hokurikuBank: hokurikuBankVal
            });
            if (result?.success) {
                const statusMessage = document.getElementById("recon-status-message");
                if (statusMessage) {
                    statusMessage.className = "success-alert";
                    statusMessage.style.background = "rgba(16, 185, 129, 0.1)";
                    statusMessage.style.border = "1px solid rgba(16, 185, 129, 0.2)";
                    statusMessage.style.color = "#10b981";
                    statusMessage.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(result.message || 'Reconciliation completed.')}`;
                }
                showToast(result.message || "Reconciliation completed.", "success");
                window.setTimeout(() => window.location.reload(), 650);
            } else {
                throw new Error(result?.error || "Failed to reconcile balance.");
            }
        } catch (error) {
            console.error("Reconciliation failed:", error);
            showToast(error.message || "Reconciliation failed.", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

function initShellUX() {
    const palette = document.getElementById("command-palette");
    const input = document.getElementById("command-input");
    const results = document.getElementById("command-results");
    const trigger = document.getElementById("command-trigger");
    const refreshBtn = document.getElementById("refresh-btn");
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const scrim = document.getElementById("sidebar-scrim");
    let activeIndex = 0;

    const pages = Array.from(document.querySelectorAll(".nav-btn")).map(btn => ({
        target: btn.dataset.target,
        label: btn.textContent.trim(),
        group: btn.closest(".sidebar-category")?.querySelector(".sidebar-category-title")?.textContent.trim() || btn.closest(".sidebar-disclosure")?.querySelector("summary span")?.textContent.trim() || "",
        icon: btn.querySelector("i")?.className || "fa-solid fa-circle"
    }));

    const navigate = target => document.querySelector(`.nav-btn[data-target="${target}"]`)?.click();
    window.navigateBudgetView = navigate;

    document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.go)));

    function render(query = "") {
        if (!results) return;
        const q = query.trim().toLowerCase();
        const filtered = pages.filter(p => `${p.label} ${p.group}`.toLowerCase().includes(q));
        activeIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
        results.innerHTML = filtered.length ? filtered.map((p, i) => `
            <button class="command-result ${i === activeIndex ? 'active' : ''}" data-command-target="${p.target}">
                <i class="${p.icon}"></i><span>${escapeHtml(p.label)}</span><small>${escapeHtml(p.group)}</small>
            </button>`).join("") : '<div class="command-empty">No page matches your search.</div>';
        results.querySelectorAll("[data-command-target]").forEach(btn => btn.addEventListener("click", () => {
            navigate(btn.dataset.commandTarget); closePalette();
        }));
    }
    function openPalette() { palette?.classList.remove("hidden"); activeIndex = 0; render(input?.value || ""); setTimeout(() => input?.focus(), 0); }
    function closePalette() { palette?.classList.add("hidden"); }
    trigger?.addEventListener("click", openPalette);
    refreshBtn?.addEventListener("click", () => window.location.reload());
    input?.addEventListener("input", () => { activeIndex = 0; render(input.value); });
    input?.addEventListener("keydown", event => {
        const items = results?.querySelectorAll("[data-command-target]") || [];
        if (event.key === "ArrowDown") { event.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); render(input.value); }
        if (event.key === "ArrowUp") { event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(input.value); }
        if (event.key === "Enter" && items.length) { event.preventDefault(); items[activeIndex]?.click(); }
    });
    palette?.addEventListener("click", event => { if (event.target === palette) closePalette(); });
    document.addEventListener("keydown", event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); palette?.classList.contains("hidden") ? openPalette() : closePalette(); }
        if (event.key === "Escape") closePalette();
    });

    mobileBtn?.addEventListener("click", () => { document.body.classList.add("sidebar-open"); scrim?.classList.remove("hidden"); });
    scrim?.addEventListener("click", () => { document.body.classList.remove("sidebar-open"); scrim.classList.add("hidden"); });

    const requestedView = (location.hash || "").replace("#", "") || localStorage.getItem("budget-last-view") || "view-balance";
    if (document.getElementById(requestedView)) navigate(requestedView);
    render();
}

function waitForBudgetCloud(timeoutMs = 12000) {
    if (window.BudgetCloud) return Promise.resolve(window.BudgetCloud);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("budgetcloudready", ready);
            reject(new Error("Neon client did not finish loading."));
        }, timeoutMs);
        function ready() {
            clearTimeout(timer);
            resolve(window.BudgetCloud);
        }
        window.addEventListener("budgetcloudready", ready, { once: true });
    });
}

async function bootstrapApplication() {
    initTheme();
    initNavigation();
    initShellUX();
    initAISimulator();

    try {
        await waitForBudgetCloud();
    } catch (error) {
        console.error("Cloud adapter failed to load:", error);
        const loading = document.getElementById("app-loading");
        const setup = document.getElementById("setup-required");
        if (loading) loading.classList.add("hidden");
        if (setup) {
            setup.classList.remove("hidden");
            const text = setup.querySelector("p");
            if (text) text.textContent = "The Neon client could not load. Check your network connection and the browser console.";
        }
        return;
    }

    window.BudgetCloud.bindAuthUI();

    if (!window.BudgetCloud?.isConfigured()) {
        window.BudgetCloud?.setGateState("setup");
        return;
    }

    try {
        window.BudgetCloud.setGateState("loading");
        const user = await window.BudgetCloud.getCurrentUser();
        if (!user) {
            window.BudgetCloud.setGateState("login");
            return;
        }
        const emailEl = document.getElementById("signed-in-email");
        if (emailEl) emailEl.textContent = user.email || "Authenticated";
        await fetchAndInitData();
        window.BudgetCloud.setGateState("app");
        initReconciliation();
    } catch (error) {
        console.error("Application bootstrap failed:", error);
        try { await window.BudgetCloud?.signOut({ reload: false }); } catch (signOutError) { console.warn("Session cleanup failed:", signOutError); }
        window.BudgetCloud?.setGateState("login", error.message || "Your session could not be verified. Please sign in again.");
    }
}

// --- Main Init Event ---
document.addEventListener("DOMContentLoaded", bootstrapApplication);

// --- CC KU Tracker Specific Logic ---
let ccKuGrouped = {};

function getCCKuPaymentDetails(dateStr, kategoriNormalized) {
    const date = new Date(dateStr);
    let year = date.getFullYear();
    let month = date.getMonth() + 1; // 1-indexed
    let day = date.getDate();
    
    // Utilities (electricity/water/gas) have a 1-month delay in credit card billing
    if (kategoriNormalized && (kategoriNormalized.includes("Utilities") || kategoriNormalized.includes("Akomodasi") || ["Electricity", "Water", "Gas"].includes(kategoriNormalized))) {
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    
    let billingStart, billingEnd, payDate;
    
    if (day <= 15) {
        const prevMonth = month - 1 === 0 ? 12 : month - 1;
        const prevYear = month - 1 === 0 ? year - 1 : year;
        
        const nextMonth = month + 1 === 13 ? 1 : month + 1;
        const nextYear = month + 1 === 13 ? year + 1 : year;
        
        billingStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-16`;
        billingEnd = `${year}-${String(month).padStart(2, '0')}-15`;
        payDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;
    } else {
        const nextMonth = month + 1 === 13 ? 1 : month + 1;
        const nextYear = month + 1 === 13 ? year + 1 : year;
        
        const payMonth = month + 2 > 12 ? (month + 2) - 12 : month + 2;
        const payYear = month + 2 > 12 ? year + 1 : year;
        
        billingStart = `${year}-${String(month).padStart(2, '0')}-16`;
        billingEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-15`;
        payDate = `${payYear}-${String(payMonth).padStart(2, '0')}-10`;
    }
    
    return { billingStart, billingEnd, payDate };
}

function initCCKuTracker() {
    const ccKuTrans = cashData.filter(item => item.payment_type === 'cashless' && item.note === 'CC KU');
    
    ccKuGrouped = {};
    ccKuTrans.forEach(item => {
        const { billingStart, billingEnd, payDate } = getCCKuPaymentDetails(item.tanggal, item.kategori_normalized);
        if (!ccKuGrouped[payDate]) {
            ccKuGrouped[payDate] = {
                payDate,
                billingStart,
                billingEnd,
                transactions: [],
                total: 0
            };
        }
        ccKuGrouped[payDate].transactions.push(item);
        ccKuGrouped[payDate].total += item.pengeluaran;
    });

    const payDates = Object.keys(ccKuGrouped).sort((a, b) => new Date(b) - new Date(a));

    const selectEl = document.getElementById("cc-ku-statement-select");
    if (!selectEl) return;
    
    selectEl.innerHTML = "";
    
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "All Statements / History";
    selectEl.appendChild(optAll);

    const currentDate = new Date();
    const todayStr = currentDate.toISOString().split('T')[0];

    payDates.forEach(pd => {
        const opt = document.createElement("option");
        opt.value = pd;
        
        let statusLabel = "";
        if (pd > todayStr) {
            statusLabel = " (Next Bill)";
        } else {
            statusLabel = " (Paid)";
        }
        
        const groupInfo = ccKuGrouped[pd];
        opt.textContent = `${pd}${statusLabel} — ¥${formatCurrency(groupInfo.total)}`;
        selectEl.appendChild(opt);
    });

    // Default select to the next outstanding payment if it exists, otherwise the most recent paid one
    const nextPayDate = [...payDates].reverse().find(pd => pd > todayStr);

    if (nextPayDate) {
        selectEl.value = nextPayDate;
        updateCCKuView(nextPayDate);
    } else if (payDates.length > 0) {
        selectEl.value = payDates[0];
        updateCCKuView(payDates[0]);
    } else {
        updateCCKuView("all");
    }

    selectEl.addEventListener("change", (e) => {
        updateCCKuView(e.target.value);
    });
}

function updateCCKuView(selectedPayDate) {
    const tableBody = document.getElementById("cc-ku-table-body");
    const countEl = document.getElementById("cc-ku-count");
    
    const kpiTotalEl = document.getElementById("kpi-cc-total");
    const kpiDateEl = document.getElementById("kpi-cc-date-subtitle");
    const kpiRangeEl = document.getElementById("kpi-cc-range-val");
    const kpiStatusEl = document.getElementById("kpi-cc-status-val");
    const kpiStatusSubEl = document.getElementById("kpi-cc-status-subtitle");
    const kpiStatusIconWrapper = document.getElementById("kpi-cc-status-icon-wrapper");

    if (!tableBody) return;

    tableBody.innerHTML = "";
    
    let transactionsToRender = [];
    let statementTotal = 0;
    let statementDateLabel = "";
    let rangeLabel = "";
    let statusText = "";
    let statusSub = "";
    let statusClass = "";
    let statusIcon = "";
    
    const currentDate = new Date();
    const todayStr = currentDate.toISOString().split('T')[0];

    if (selectedPayDate === "all") {
        const allTrans = [];
        let grandTotal = 0;
        Object.keys(ccKuGrouped).forEach(pd => {
            allTrans.push(...ccKuGrouped[pd].transactions);
            grandTotal += ccKuGrouped[pd].total;
        });
        
        allTrans.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        transactionsToRender = allTrans;
        
        statementTotal = grandTotal;
        statementDateLabel = "Lifetime CC KU Spending";
        rangeLabel = "All Recorded Cycles";
        statusText = "CC Active";
        statusSub = `${Object.keys(ccKuGrouped).length} billing cycles total`;
        statusClass = "badge-status-future";
        statusIcon = '<i class="fa-solid fa-credit-card"></i>';
    } else {
        const groupInfo = ccKuGrouped[selectedPayDate];
        if (groupInfo) {
            transactionsToRender = [...groupInfo.transactions].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
            statementTotal = groupInfo.total;
            statementDateLabel = `Auto-debit on ${selectedPayDate}`;
            
            const formatMonthDay = (dateStr) => {
                const parts = dateStr.split('-');
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return `${monthNames[parseInt(parts[1]) - 1]} ${parts[2]}`;
            };
            rangeLabel = `${formatMonthDay(groupInfo.billingStart)} - ${formatMonthDay(groupInfo.billingEnd)}`;
            
            if (selectedPayDate > todayStr) {
                statusText = "Outstanding";
                statusSub = "Pending bank auto-debit";
                statusClass = "badge-status-outstanding";
                statusIcon = '<i class="fa-solid fa-clock"></i>';
            } else {
                statusText = "Paid & Cleared";
                statusSub = "Auto-debited from bank";
                statusClass = "badge-status-paid";
                statusIcon = '<i class="fa-solid fa-circle-check"></i>';
            }
        }
    }

    kpiTotalEl.textContent = formatCurrency(statementTotal);
    kpiDateEl.textContent = statementDateLabel;
    kpiRangeEl.textContent = rangeLabel;
    
    kpiStatusEl.textContent = statusText;
    kpiStatusSubEl.textContent = statusSub;
    
    const statusCard = document.querySelector(".card-cc-status");
    if (statusCard) {
        if (statusText === "Outstanding") {
            statusCard.style.setProperty('--color-savings', '#fbbf24');
            statusCard.style.setProperty('--color-savings-glow', 'rgba(251, 191, 36, 0.15)');
        } else if (statusText === "Paid & Cleared") {
            statusCard.style.setProperty('--color-savings', 'var(--color-income)');
            statusCard.style.setProperty('--color-savings-glow', 'var(--color-income-glow)');
        } else {
            statusCard.style.setProperty('--color-savings', 'var(--color-primary)');
            statusCard.style.setProperty('--color-savings-glow', 'var(--color-primary-glow)');
        }
    }

    if (kpiStatusIconWrapper) {
        kpiStatusIconWrapper.innerHTML = statusIcon;
        kpiStatusIconWrapper.className = `kpi-icon-wrapper`;
        if (statusText === "Outstanding") {
            kpiStatusIconWrapper.style.color = "#f59e0b";
            kpiStatusIconWrapper.style.background = "rgba(245, 158, 11, 0.15)";
        } else if (statusText === "Paid & Cleared") {
            kpiStatusIconWrapper.style.color = "var(--color-income)";
            kpiStatusIconWrapper.style.background = "var(--color-income-glow)";
        } else {
            kpiStatusIconWrapper.style.color = "var(--color-primary)";
            kpiStatusIconWrapper.style.background = "var(--color-primary-glow)";
        }
    }

    countEl.textContent = `Showing ${transactionsToRender.length} transactions`;

    if (transactionsToRender.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No credit card transactions found for this period.</td></tr>`;
        return;
    }

    transactionsToRender.forEach(item => {
        const row = document.createElement("tr");
        
        let subtextHtml = '';
        if (item.item !== item.item_normalized) {
            subtextHtml = `<div class="table-subtext">${escapeHtml(item.item)}</div>`;
        }
        
        const amtSign = item.pengeluaran < 0 ? "- " : "";
        const amtColor = item.pengeluaran < 0 ? "color: #10b981;" : "color: var(--color-expense);";

        row.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
            <td style="white-space: nowrap;">${item.tanggal}</td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item_normalized)}</div>
                ${subtextHtml}
            </td>
            <td>${getCategoryBadgeHtml(item.kategori_normalized)}</td>
            <td>${item.tempat ? escapeHtml(item.tempat) : '<span style="color: var(--text-muted); font-style: italic;">N/A</span>'}</td>
            <td class="amount-col" style="font-weight: 600; ${amtColor}">${amtSign}¥${formatCurrency(Math.abs(item.pengeluaran))}</td>
        `;
        tableBody.appendChild(row);
    });
}

// --- Toped Card Tracker Specific Logic ---
let topedCardGrouped = {};
let spaylaterGrouped = {};

function getTopedCardPaymentDetails(item) {
    const note = item.note || '';
    
    // Check if the note specifies a statement date, e.g. "Tokopedia Card (Stmt: 2026-04-15) (Rp 353,992)"
    const match = note.match(/stmt:\s*(\d{4}-\d{2}-\d{2})/i);
    let stmtDateStr;
    if (match) {
        stmtDateStr = match[1];
    } else {
        // Fallback for older transactions: cutoff is 15th of the month
        const date = new Date(item.tanggal);
        let year = date.getFullYear();
        let month = date.getMonth() + 1; // 1-indexed
        let day = date.getDate();
        if (day > 15) {
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }
        stmtDateStr = `${year}-${String(month).padStart(2, '0')}-15`;
    }
    
    // Calculate due date (2nd of next month)
    const stmtDate = new Date(stmtDateStr);
    let stmtYear = stmtDate.getFullYear();
    let stmtMonth = stmtDate.getMonth() + 1;
    
    let dueMonth = stmtMonth + 1;
    let dueYear = stmtYear;
    if (dueMonth > 12) {
        dueMonth = 1;
        dueYear += 1;
    }
    const payDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-02`;
    
    // Cutoff cycle range
    const cutoffDate = new Date(stmtDateStr);
    let cutoffYear = cutoffDate.getFullYear();
    let cutoffMonth = cutoffDate.getMonth() + 1;
    
    let startMonth = cutoffMonth - 1;
    let startYear = cutoffYear;
    if (startMonth === 0) {
        startMonth = 12;
        startYear -= 1;
    }
    const billingStart = `${startYear}-${String(startMonth).padStart(2, '0')}-16`;
    const billingEnd = stmtDateStr;
    
    return { billingStart, billingEnd, payDate, statementDate: stmtDateStr };
}

function getTargetPayDateForPayment(paymentDateStr) {
    const date = new Date(paymentDateStr);
    let year = date.getFullYear();
    let month = date.getMonth() + 1; // 1-indexed
    let day = date.getDate();
    
    let stmtYear, stmtMonth;
    if (day >= 16) {
        stmtYear = year;
        stmtMonth = month;
    } else {
        stmtMonth = month - 1;
        stmtYear = year;
        if (stmtMonth === 0) {
            stmtMonth = 12;
            stmtYear = year - 1;
        }
    }
    
    let dueMonth = stmtMonth + 1;
    let dueYear = stmtYear;
    if (dueMonth > 12) {
        dueMonth = 1;
        dueYear += 1;
    }
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-02`;
}

function initTopedCardTracker() {
    // Filter Tokopedia Card transactions: note contains "Tokopedia Card" or contains "CC" (but not "CC KU")
    const topedTrans = cashData.filter(item => {
        if (item.payment_type !== 'cashless') return false;
        const note = (item.note || '').toLowerCase();
        return note.includes("tokopedia card") || (note.includes("cc") && !note.includes("cc ku"));
    });

    // Find the latest statement date overall across Tokopedia card payments
    let maxStmtDateStr = "";
    topedTrans.forEach(item => {
        const details = getTopedCardPaymentDetails(item);
        const stmtDate = details ? details.statementDate : null;
        if (stmtDate && stmtDate > maxStmtDateStr) {
            maxStmtDateStr = stmtDate;
        }
    });

    // Identify active installment plans to project future payments
    const instPattern = /(.*?)\s*:\s*(\d+)\s*\/\s*(\d+)/;
    const installmentsMap = {};

    topedTrans.forEach(item => {
        const match = item.item.match(instPattern);
        if (match) {
            const rawName = match[1].trim();
            const currInst = parseInt(match[2]);
            const totalInst = parseInt(match[3]);

            if (currInst === 0) return; // Skip conversion credit placeholder

            // Suffix extraction logic for collision prevention
            const rawCleaned = rawName.replace("CCL06", "").replace("CCL12", "").trim();
            const suffixMatch = rawCleaned.match(/[-_\s]+(\d+|CCLN)$/);
            const suffix = suffixMatch ? suffixMatch[1] : "";

            // Clean up name
            let baseName = rawName
                .replace(/^BRINGTV1-/, '')
                .replace(/^TOKOPEDIA_CYBS_/, 'Tokopedia ')
                .replace(/_3DS$/, '')
                .replace(/3DS$/, '')
                .replace(/CCLN$/, '')
                .replace(/CCL06$/, '')
                .replace(/CCL12$/, '')
                .trim();

            baseName = baseName.replace(/[-_\s]+\d+$/, '').trim();
            baseName = baseName.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            
            if (baseName.includes("Ibox")) baseName = "iBox Purchase";
            if (baseName.includes("Traveloka")) baseName = "Traveloka Booking";
            if (baseName.includes("Tiket.com") || baseName.includes("Tiket .com")) baseName = "Tiket.com Ticket";
            if (baseName.includes("Chineastair")) baseName = "China Eastern Airlines Ticket";
            if (baseName === "Tokopedia") baseName = "Samsung Galaxy Tab A9+ 8/128GB - Graphite";

            let cleanName = suffix ? `${baseName} (${suffix})` : baseName;
            if (suffix === "1345093746") {
                cleanName = "Tiket Air China (Jakarta → Tokyo)";
            } else if (suffix === "128") {
                cleanName = "Hotel Zest Airport Jakarta by Swiss-Belhotel International";
            } else if (suffix === "128220") {
                cleanName = "Hotel New Saphir Yogyakarta";
            } else if (suffix === "125") {
                cleanName = "Cavinton Hotel Malioboro Yogyakarta";
            } else if (suffix === "CCLN") {
                cleanName = "Whiz Hotel Cikini Jakarta";
            } else if (cleanName === "Tiket.com Ticket" && totalInst === 12) {
                cleanName = "KA Panorama Bandung -> Kroya";
            } else if (cleanName === "Tiket.com Ticket" && totalInst === 6) {
                cleanName = "Hotel Novotel Bandung";
            }
            const key = `${cleanName}_${totalInst}`;

            let idrValue = item.extracted_idr || 0;
            if (idrValue === 0) {
                const matchIdr = (item.note || '').match(/Rp\s*([\d,]+)/i);
                if (matchIdr) {
                    idrValue = parseFloat(matchIdr[1].replace(/,/g, ''));
                } else {
                    idrValue = item.pengeluaran * getExchangeRate();
                }
            }

            if (!installmentsMap[key]) {
                installmentsMap[key] = {
                    key,
                    name: cleanName,
                    totalInst,
                    monthlyIdr: idrValue,
                    monthlyJpy: item.pengeluaran,
                    payments: []
                };
            }
            installmentsMap[key].payments.push({
                currInst,
                date: item.tanggal,
                stmtDate: getTopedCardPaymentDetails(item).statementDate
            });
        }
    });

    const activePlans = [];
    Object.values(installmentsMap).forEach(plan => {
        plan.payments.sort((a, b) => b.currInst - a.currInst);
        const latestPayment = plan.payments[0];

        let monthsPaid = latestPayment.currInst;
        let monthsLeft = plan.totalInst - monthsPaid;
        let isCompleted = (monthsLeft === 0);

        // Auto-complete logic based on statement dates compared to overall latest statement
        let endStmtDateStr = "";
        if (latestPayment.stmtDate) {
            const parts = latestPayment.stmtDate.split("-");
            const stmtDate = new Date(parts[0], parts[1] - 1, parts[2]);
            stmtDate.setMonth(stmtDate.getMonth() + monthsLeft);
            const endYear = stmtDate.getFullYear();            const endMonth = String(stmtDate.getMonth() + 1).padStart(2, '0');
            endStmtDateStr = `${endYear}-${endMonth}-15`;
        }

        if (!isCompleted && endStmtDateStr && maxStmtDateStr && endStmtDateStr <= maxStmtDateStr) {
            isCompleted = true;
            monthsPaid = plan.totalInst;
            monthsLeft = 0;
        }

        if (!isCompleted) {
            activePlans.push({
                name: plan.name,
                key: plan.key,
                totalInst: plan.totalInst,
                monthlyIdr: plan.monthlyIdr,
                monthlyJpy: plan.monthlyJpy,
                latestPayment,
                monthsPaid,
                monthsLeft
            });
        }
    });
    
    topedCardGrouped = {};
    topedTrans.forEach(item => {
        const itemNameUpper = (item.item || '').toUpperCase();
        const isRepayment = itemNameUpper.startsWith("PAYMENT_") || itemNameUpper.includes("PAYMENT_KKCB");
        
        if (isRepayment) {
            const targetPayDate = getTargetPayDateForPayment(item.tanggal);
            if (!topedCardGrouped[targetPayDate]) {
                const parts = targetPayDate.split("-");
                let dueYear = parseInt(parts[0]);
                let dueMonth = parseInt(parts[1]);
                let stmtMonth = dueMonth - 1;
                let stmtYear = dueYear;
                if (stmtMonth === 0) {
                    stmtMonth = 12;
                    stmtYear = dueYear - 1;
                }
                const statementDate = `${stmtYear}-${String(stmtMonth).padStart(2, '0')}-15`;
                
                let startMonth = stmtMonth - 1;
                let startYear = stmtYear;
                if (startMonth === 0) {
                    startMonth = 12;
                    startYear = stmtYear - 1;
                }
                const billingStart = `${startYear}-${String(startMonth).padStart(2, '0')}-16`;
                const billingEnd = `${stmtYear}-${String(stmtMonth).padStart(2, '0')}-15`;
                
                topedCardGrouped[targetPayDate] = {
                    payDate: targetPayDate,
                    statementDate,
                    billingStart,
                    billingEnd,
                    transactions: [],
                    totalJpy: 0,
                    totalIdr: 0,
                    isPaid: false,
                    paymentDetails: null
                };
            }
            
            let idrValue = 0;
            const match = (item.note || '').match(/Rp\s*([\d,]+)/i);
            if (match) {
                idrValue = parseFloat(match[1].replace(/,/g, ''));
            }
            
            topedCardGrouped[targetPayDate].isPaid = true;
            topedCardGrouped[targetPayDate].paymentDetails = {
                date: item.tanggal,
                item: item.item,
                amountIdr: idrValue
            };
            
            item.extracted_idr = -idrValue;
            topedCardGrouped[targetPayDate].transactions.push(item);
        } else {
            const { billingStart, billingEnd, payDate, statementDate } = getTopedCardPaymentDetails(item);
            if (!topedCardGrouped[payDate]) {
                topedCardGrouped[payDate] = {
                    payDate,
                    statementDate,
                    billingStart,
                    billingEnd,
                    transactions: [],
                    totalJpy: 0,
                    totalIdr: 0,
                    isPaid: false,
                    paymentDetails: null
                };
            }
            topedCardGrouped[payDate].transactions.push(item);
            topedCardGrouped[payDate].totalJpy += item.pengeluaran;
            
            let idrValue = 0;
            if (item.expense_idr !== null && item.expense_idr !== undefined && !isNaN(item.expense_idr)) {
                idrValue = item.expense_idr;
            } else {
                const match = (item.note || '').match(/(-?Rp\s*[\d,]+)/i);
                if (match) {
                    const isNeg = match[1].startsWith('-');
                    idrValue = parseFloat(match[1].replace(/[^\d]/g, ''));
                    if (isNeg) idrValue = -idrValue;
                } else if (item.note && item.note.includes("Rp")) {
                    const cleanedNote = item.note.replace(/\./g, '');
                    const isNeg = cleanedNote.includes("-Rp");
                    const fuzzyMatch = cleanedNote.match(/Rp\s*(\d+)/i);
                    if (fuzzyMatch) {
                        idrValue = parseFloat(fuzzyMatch[1]);
                        if (isNeg) idrValue = -idrValue;
                    }
                }
                
                if (idrValue === 0 && item.pengeluaran !== 0) {
                    idrValue = item.pengeluaran * getExchangeRate();
                }
            }
            topedCardGrouped[payDate].totalIdr += idrValue;
            item.extracted_idr = idrValue;
        }
    });

    // Project future statement cycles based on active installments
    activePlans.forEach(plan => {
        const latestPayment = plan.latestPayment;
        const currInst = plan.monthsPaid;
        const totalInst = plan.totalInst;
        
        for (let i = currInst + 1; i <= totalInst; i++) {
            const monthsForward = i - currInst;
            
            // Calculate statementDate by adding monthsForward to latestPayment.stmtDate
            const parts = latestPayment.stmtDate.split("-");
            const stmtDate = new Date(parts[0], parts[1] - 1, parts[2]);
            stmtDate.setMonth(stmtDate.getMonth() + monthsForward);
            
            const year = stmtDate.getFullYear();
            const monthVal = stmtDate.getMonth() + 1;
            const stmtDateStr = `${year}-${String(monthVal).padStart(2, '0')}-15`;
            
            // Calculate payDate (2nd of next month)
            let dueMonth = monthVal + 1;
            let dueYear = year;
            if (dueMonth > 12) {
                dueMonth = 1;
                dueYear += 1;
            }
            const payDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-02`;
            
            // Calculate billingStart (16th of previous month) and billingEnd
            let startMonth = monthVal - 1;
            let startYear = year;
            if (startMonth === 0) {
                startMonth = 12;
                startYear = year - 1;
            }
            const billingStart = `${startYear}-${String(startMonth).padStart(2, '0')}-16`;
            const billingEnd = stmtDateStr;
            
            if (!topedCardGrouped[payDate]) {
                topedCardGrouped[payDate] = {
                    payDate,
                    statementDate: stmtDateStr,
                    billingStart,
                    billingEnd,
                    transactions: [],
                    totalJpy: 0,
                    totalIdr: 0,
                    isPaid: false,
                    paymentDetails: null
                };
            }
            
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            
            // Build projected transaction item
            const projectedItem = {
                id: `Proj-${plan.name.replace(/[^a-zA-Z0-9]/g, '')}-${i}`,
                tanggal: stmtDateStr,
                item: `${plan.name} : ${i}/${totalInst}`,
                item_normalized: plan.name,
                kategori_normalized: "Transportation",
                pengeluaran: plan.monthlyJpy,
                extracted_idr: plan.monthlyIdr,
                note: `Projected Installment for ${monthNames[monthVal - 1]} ${year}`,
                isProjected: true
            };
            
            if (plan.name.toLowerCase().includes("ibox")) {
                projectedItem.kategori_normalized = "Others";
            } else if (plan.name.toLowerCase().includes("traveloka") || plan.name.toLowerCase().includes("tiket")) {
                projectedItem.kategori_normalized = "Transportation";
            }
            
            topedCardGrouped[payDate].transactions.push(projectedItem);
            topedCardGrouped[payDate].totalJpy += plan.monthlyJpy;
            topedCardGrouped[payDate].totalIdr += plan.monthlyIdr;
        }
    });

    const payDates = Object.keys(topedCardGrouped).sort((a, b) => new Date(b) - new Date(a));

    const selectEl = document.getElementById("toped-card-statement-select");
    if (!selectEl) return;
    
    selectEl.innerHTML = "";
    
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "All Statements / History";
    selectEl.appendChild(optAll);

    const currentDate = new Date();
    const todayStr = currentDate.toISOString().split('T')[0];

    payDates.forEach(pd => {
        const opt = document.createElement("option");
        opt.value = pd;
        
        const groupInfo = topedCardGrouped[pd];
        let statusLabel = "";
        if (groupInfo.isPaid) {
            statusLabel = " (Paid)";
        } else if (pd > todayStr) {
            statusLabel = " (Next Bill)";
        } else {
            statusLabel = " (Paid)";
        }
        
        opt.textContent = `${groupInfo.statementDate}${statusLabel} — Rp ${formatCurrency(Math.round(groupInfo.totalIdr))}`;
        selectEl.appendChild(opt);
    });

    // Default select to the most recent statement pay date that has been billed (statementDate <= maxStmtDateStr)
    let defaultPayDate = "all";
    const activePayDate = payDates.find(pd => topedCardGrouped[pd].statementDate <= maxStmtDateStr);
    if (activePayDate) {
        defaultPayDate = activePayDate;
    } else if (payDates.length > 0) {
        defaultPayDate = payDates[payDates.length - 1]; // Oldest if none match
    }

    if (defaultPayDate !== "all") {
        selectEl.value = defaultPayDate;
        updateTopedCardView(defaultPayDate);
    } else {
        updateTopedCardView("all");
    }

    selectEl.addEventListener("change", (e) => {
        updateTopedCardView(e.target.value);
    });

    updateTopedInstallmentsTracker();
}

function updateTopedInstallmentsTracker() {
    const tableBody = document.getElementById("toped-installments-table-body");
    const countEl = document.getElementById("toped-installments-count");
    const kpiTotalIdrEl = document.getElementById("kpi-toped-inst-total-idr");
    const kpiTotalJpyEl = document.getElementById("kpi-toped-inst-total-jpy");
    const kpiSubtitleEl = document.getElementById("kpi-toped-inst-subtitle");

    if (!tableBody) return;

    tableBody.innerHTML = "";

    // 1. Filter all Tokopedia Card transactions from cashData
    const topedTrans = cashData.filter(item => {
        if (item.payment_type !== 'cashless') return false;
        const note = (item.note || '').toLowerCase();
        return note.includes("tokopedia card") || (note.includes("cc") && !note.includes("cc ku"));
    });

    // Find the latest statement date overall across Tokopedia card payments
    let maxStmtDateStr = "";
    topedTrans.forEach(item => {
        const details = getTopedCardPaymentDetails(item);
        const stmtDate = details ? details.statementDate : null;
        if (stmtDate && stmtDate > maxStmtDateStr) {
            maxStmtDateStr = stmtDate;
        }
    });

    // 2. Identify installment plans: item matches name : XX/YY
    const instPattern = /(.*?)\s*:\s*(\d+)\s*\/\s*(\d+)/;
    const installmentsMap = {};

    topedTrans.forEach(item => {
        const match = item.item.match(instPattern);
        if (match) {
            const rawName = match[1].trim();
            const currInst = parseInt(match[2]);
            const totalInst = parseInt(match[3]);

            if (currInst === 0) return; // Skip conversion credit placeholder

            // Suffix extraction logic for collision prevention
            const rawCleaned = rawName.replace("CCL06", "").replace("CCL12", "").trim();
            const suffixMatch = rawCleaned.match(/[-_\s]+(\d+|CCLN)$/);
            const suffix = suffixMatch ? suffixMatch[1] : "";

            // Clean up name for user display
            let baseName = rawName
                .replace(/^BRINGTV1-/, '')
                .replace(/^TOKOPEDIA_CYBS_/, 'Tokopedia ')
                .replace(/_3DS$/, '')
                .replace(/3DS$/, '')
                .replace(/CCLN$/, '')
                .replace(/CCL06$/, '')
                .replace(/CCL12$/, '')
                .trim();

            // Strip trailing numeric suffix
            baseName = baseName.replace(/[-_\s]+\d+$/, '').trim();

            // Capitalize first letter of each word
            baseName = baseName.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            
            // Map common ones to very clean names
            if (baseName.includes("Ibox")) baseName = "iBox Purchase";
            if (baseName.includes("Traveloka")) baseName = "Traveloka Booking";
            if (baseName.includes("Tiket.com") || baseName.includes("Tiket .com")) baseName = "Tiket.com Ticket";
            if (baseName.includes("Chineastair")) baseName = "China Eastern Airlines Ticket";
            if (baseName === "Tokopedia") baseName = "Samsung Galaxy Tab A9+ 8/128GB - Graphite";

            let cleanName = suffix ? `${baseName} (${suffix})` : baseName;
            if (suffix === "1345093746") {
                cleanName = "Tiket Air China (Jakarta → Tokyo)";
            } else if (suffix === "128") {
                cleanName = "Hotel Zest Airport Jakarta by Swiss-Belhotel International";
            } else if (suffix === "128220") {
                cleanName = "Hotel New Saphir Yogyakarta";
            } else if (suffix === "125") {
                cleanName = "Cavinton Hotel Malioboro Yogyakarta";
            } else if (suffix === "CCLN") {
                cleanName = "Whiz Hotel Cikini Jakarta";
            } else if (cleanName === "Tiket.com Ticket" && totalInst === 12) {
                cleanName = "KA Panorama Bandung -> Kroya";
            } else if (cleanName === "Tiket.com Ticket" && totalInst === 6) {
                cleanName = "Hotel Novotel Bandung";
            }
            const key = `${cleanName}_${totalInst}`;

            let idrValue = item.extracted_idr || 0;
            if (idrValue === 0) {
                const matchIdr = (item.note || '').match(/Rp\s*([\d,]+)/i);
                if (matchIdr) {
                    idrValue = parseFloat(matchIdr[1].replace(/,/g, ''));
                } else {
                    idrValue = item.pengeluaran * getExchangeRate();
                }
            }

            if (!installmentsMap[key]) {
                installmentsMap[key] = {
                    key,
                    name: cleanName,
                    totalInst,
                    monthlyIdr: idrValue,
                    monthlyJpy: item.pengeluaran,
                    payments: []
                };
            }
            installmentsMap[key].payments.push({
                currInst,
                date: item.tanggal,
                stmtDate: getTopedCardPaymentDetails(item).statementDate
            });
        }
    });

    // 3. Process each installment plan to find the latest billing status
    const plans = [];
    let grandOutstandingIdr = 0;
    let grandOutstandingJpy = 0;
    let activePlansCount = 0;

    Object.values(installmentsMap).forEach(plan => {
        // Find payment with the maximum currInst
        plan.payments.sort((a, b) => b.currInst - a.currInst);
        const latestPayment = plan.payments[0];

        let monthsPaid = latestPayment.currInst;
        let monthsLeft = plan.totalInst - monthsPaid;
        let pctPaid = (monthsPaid / plan.totalInst) * 100;
        let isCompleted = (monthsLeft === 0);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        // Calculate Start Statement Month: subtract (monthsPaid - 1) months from latest statement date
        let startStatementLabel = "Unknown";
        let startStmtDateStr = "";
        if (latestPayment.stmtDate) {
            const parts = latestPayment.stmtDate.split("-");
            const stmtDate = new Date(parts[0], parts[1] - 1, parts[2]);
            stmtDate.setMonth(stmtDate.getMonth() - (monthsPaid - 1));
            startStatementLabel = `${monthNames[stmtDate.getMonth()]} 15, ${stmtDate.getFullYear()}`;
            
            const startYear = stmtDate.getFullYear();
            const startMonth = String(stmtDate.getMonth() + 1).padStart(2, '0');
            startStmtDateStr = `${startYear}-${startMonth}-15`;
        }

        // Calculate End Statement Month: add monthsLeft (totalInst - monthsPaid) months to latest statement date
        let endStatementLabel = "Unknown";
        let endStmtDateStr = "";
        if (latestPayment.stmtDate) {
            const parts = latestPayment.stmtDate.split("-");
            const stmtDate = new Date(parts[0], parts[1] - 1, parts[2]);
            stmtDate.setMonth(stmtDate.getMonth() + monthsLeft);
            endStatementLabel = `${monthNames[stmtDate.getMonth()]} 15, ${stmtDate.getFullYear()}`;
            
            const endYear = stmtDate.getFullYear();
            const endMonth = String(stmtDate.getMonth() + 1).padStart(2, '0');
            endStmtDateStr = `${endYear}-${endMonth}-15`;
        }

        // Auto-complete logic: if calculated end statement date is <= maxStmtDateStr, then the plan is completed!
        if (!isCompleted && endStmtDateStr && maxStmtDateStr && endStmtDateStr <= maxStmtDateStr) {
            isCompleted = true;
            monthsPaid = plan.totalInst;
            monthsLeft = 0;
            pctPaid = 100;
        }

        const totalPaidIdr = monthsPaid * plan.monthlyIdr;
        const totalPaidJpy = monthsPaid * plan.monthlyJpy;
        const totalLeftIdr = monthsLeft * plan.monthlyIdr;
        const totalLeftJpy = monthsLeft * plan.monthlyJpy;
        const totalPaymentIdr = plan.totalInst * plan.monthlyIdr;
        const totalPaymentJpy = plan.totalInst * plan.monthlyJpy;

        if (!isCompleted) {
            grandOutstandingIdr += totalLeftIdr;
            grandOutstandingJpy += totalLeftJpy;
            activePlansCount++;
        }

        plans.push({
            name: plan.name,
            monthlyIdr: plan.monthlyIdr,
            monthlyJpy: plan.monthlyJpy,
            totalInst: plan.totalInst,
            monthsPaid,
            monthsLeft,
            totalPaidIdr,
            totalPaidJpy,
            totalLeftIdr,
            totalLeftJpy,
            totalPaymentIdr,
            totalPaymentJpy,
            pctPaid,
            isCompleted,
            startStatement: startStatementLabel,
            endStatement: endStatementLabel
        });
    });

    // Sort: active plans first, then completed plans
    plans.sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) {
            return a.isCompleted ? 1 : -1;
        }
        if (!a.isCompleted) {
            return b.totalLeftIdr - a.totalLeftIdr;
        }
        return b.totalPaidIdr - a.totalPaidIdr;
    });

    // 4. Update KPI elements
    if (kpiTotalIdrEl) kpiTotalIdrEl.textContent = formatCurrency(Math.round(grandOutstandingIdr));
    if (kpiTotalJpyEl) kpiTotalJpyEl.textContent = formatCurrency(Math.round(grandOutstandingJpy));
    if (kpiSubtitleEl) kpiSubtitleEl.textContent = `${activePlansCount} active installment plans`;

    if (countEl) {
        countEl.textContent = `${activePlansCount} active / ${plans.length} total plans`;
    }

    // 5. Render rows
    if (plans.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="empty-table-msg">No installment transactions found.</td></tr>`;
        return;
    }

    plans.forEach((p, idx) => {
        const tr = document.createElement("tr");
        if (p.isCompleted) {
            tr.style.opacity = "0.65";
        }

        const progressColor = p.isCompleted ? "#10b981" : "#3b82f6";
        const progressHtml = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="flex: 1; min-width: 60px; background: rgba(148, 163, 184, 0.15); height: 6px; border-radius: 3px; overflow: hidden;">
                    <div style="background: ${progressColor}; width: ${p.pctPaid}%; height: 100%; border-radius: 3px;"></div>
                </div>
                <span style="font-size: 0.75rem; font-weight: 600; min-width: 30px; text-align: right; color: var(--text-secondary);">${Math.round(p.pctPaid)}%</span>
            </div>
        `;

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${idx + 1}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                    <span style="font-weight: 600; color: var(--text-primary);">${p.name}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${p.totalInst} months plan</span>
                </div>
            </td>
            <td class="amount-col">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="font-weight: 500;">Rp ${formatCurrency(Math.round(p.monthlyIdr))}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">~ ¥${formatCurrency(Math.round(p.monthlyJpy))}</span>
                </div>
            </td>
            <td class="amount-col">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="font-weight: 500;">Rp ${formatCurrency(Math.round(p.totalPaymentIdr))}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">~ ¥${formatCurrency(Math.round(p.totalPaymentJpy))}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                    <span style="font-weight: 500;">${p.monthsPaid} / ${p.totalInst} billed</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${p.monthsLeft} left</span>
                </div>
            </td>
            <td>${progressHtml}</td>
            <td class="amount-col">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="font-weight: 500;">Rp ${formatCurrency(Math.round(p.totalPaidIdr))}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">~ ¥${formatCurrency(Math.round(p.totalPaidJpy))}</span>
                </div>
            </td>
            <td class="amount-col">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="font-weight: 600; color: ${p.isCompleted ? 'var(--text-muted)' : 'var(--text-primary)'};">Rp ${formatCurrency(Math.round(p.totalLeftIdr))}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">~ ¥${formatCurrency(Math.round(p.totalLeftJpy))}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <i class="fa-regular fa-calendar-plus" style="color: #64748b;"></i>
                    <span style="font-weight: 500; color: var(--text-secondary);">${p.startStatement}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    ${p.isCompleted ? '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i>' : '<i class="fa-regular fa-clock" style="color: #3b82f6;"></i>'}
                    <span style="font-weight: 500; color: ${p.isCompleted ? '#10b981' : 'var(--text-primary)'};">${p.endStatement}</span>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function updateTopedCardView(selectedPayDate) {
    const tableBody = document.getElementById("toped-card-table-body");
    const countEl = document.getElementById("toped-card-count");
    
    const kpiTotalIdrEl = document.getElementById("kpi-toped-total-idr");
    const kpiTotalJpyEl = document.getElementById("kpi-toped-total-jpy");
    const kpiDateEl = document.getElementById("kpi-toped-date-subtitle");
    const kpiRangeEl = document.getElementById("kpi-toped-range-val");
    const kpiStatusEl = document.getElementById("kpi-toped-status-val");
    const kpiStatusSubEl = document.getElementById("kpi-toped-status-subtitle");
    const kpiStatusIconWrapper = document.getElementById("kpi-toped-status-icon-wrapper");

    if (!tableBody) return;

    tableBody.innerHTML = "";
    
    let transactionsToRender = [];
    let statementTotalIdr = 0;
    let statementTotalJpy = 0;
    let statementDateLabel = "";
    let rangeLabel = "";
    let statusText = "";
    let statusSub = "";
    let statusIcon = "";
    
    const currentDate = new Date();
    const todayStr = currentDate.toISOString().split('T')[0];

    if (selectedPayDate === "all") {
        const allTrans = [];
        let grandTotalIdr = 0;
        let grandTotalJpy = 0;
        Object.keys(topedCardGrouped).forEach(pd => {
            allTrans.push(...topedCardGrouped[pd].transactions);
            grandTotalIdr += topedCardGrouped[pd].totalIdr;
            grandTotalJpy += topedCardGrouped[pd].totalJpy;
        });
        
        allTrans.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        transactionsToRender = allTrans;
        
        statementTotalIdr = grandTotalIdr;
        statementTotalJpy = grandTotalJpy;
        statementDateLabel = "Lifetime Tokopedia Card Spending";
        rangeLabel = "All Recorded Cycles";
        statusText = "Card Active";
        statusSub = `${Object.keys(topedCardGrouped).length} billing statements total`;
        statusIcon = '<i class="fa-solid fa-credit-card"></i>';
    } else {
        const groupInfo = topedCardGrouped[selectedPayDate];
        if (groupInfo) {
            transactionsToRender = [...groupInfo.transactions].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
            statementTotalIdr = groupInfo.totalIdr;
            statementTotalJpy = groupInfo.totalJpy;
            statementDateLabel = `Statement Date: ${groupInfo.statementDate}`;
            
            const formatMonthDay = (dateStr) => {
                const parts = dateStr.split('-');
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                return `${monthNames[parseInt(parts[1]) - 1]} ${parts[2]}`;
            };
            rangeLabel = `${formatMonthDay(groupInfo.billingStart)} - ${formatMonthDay(groupInfo.billingEnd)}`;
            
            if (groupInfo.isPaid) {
                statusText = "Paid & Cleared";
                const pDate = groupInfo.paymentDetails ? groupInfo.paymentDetails.date : selectedPayDate;
                statusSub = `Paid on ${pDate} with IDR savings`;
                statusIcon = '<i class="fa-solid fa-circle-check"></i>';
            } else if (selectedPayDate > todayStr) {
                statusText = "Outstanding";
                statusSub = `Due on ${selectedPayDate}`;
                statusIcon = '<i class="fa-solid fa-clock"></i>';
            } else {
                statusText = "Paid & Cleared";
                statusSub = `Paid on ${selectedPayDate} with IDR savings`;
                statusIcon = '<i class="fa-solid fa-circle-check"></i>';
            }
        }
    }

    kpiTotalIdrEl.textContent = formatCurrency(Math.round(statementTotalIdr));
    kpiTotalJpyEl.textContent = formatCurrency(Math.round(statementTotalJpy));
    kpiDateEl.textContent = statementDateLabel;
    kpiRangeEl.textContent = rangeLabel;
    
    kpiStatusEl.textContent = statusText;
    kpiStatusSubEl.textContent = statusSub;
    
    const statusCard = document.querySelector(".card-toped-status");
    if (statusCard) {
        if (statusText === "Outstanding") {
            statusCard.style.setProperty('--color-savings', '#fbbf24');
            statusCard.style.setProperty('--color-savings-glow', 'rgba(251, 191, 36, 0.15)');
        } else if (statusText === "Paid & Cleared") {
            statusCard.style.setProperty('--color-savings', 'var(--color-income)');
            statusCard.style.setProperty('--color-savings-glow', 'var(--color-income-glow)');
        } else {
            statusCard.style.setProperty('--color-savings', 'var(--color-primary)');
            statusCard.style.setProperty('--color-savings-glow', 'var(--color-primary-glow)');
        }
    }

    if (kpiStatusIconWrapper) {
        kpiStatusIconWrapper.innerHTML = statusIcon;
        kpiStatusIconWrapper.className = `kpi-icon-wrapper`;
        if (statusText === "Outstanding") {
            kpiStatusIconWrapper.style.color = "#f59e0b";
            kpiStatusIconWrapper.style.background = "rgba(245, 158, 11, 0.15)";
        } else if (statusText === "Paid & Cleared") {
            kpiStatusIconWrapper.style.color = "var(--color-income)";
            kpiStatusIconWrapper.style.background = "var(--color-income-glow)";
        } else {
            kpiStatusIconWrapper.style.color = "var(--color-primary)";
            kpiStatusIconWrapper.style.background = "var(--color-primary-glow)";
        }
    }

    countEl.textContent = `Showing ${transactionsToRender.length} transactions`;

    if (transactionsToRender.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No Tokopedia Card transactions found for this period.</td></tr>`;
        return;
    }

    transactionsToRender.forEach(item => {
        const row = document.createElement("tr");
        if (item.isProjected) {
            row.style.opacity = "0.75";
            row.style.fontStyle = "italic";
        }
        
        let subtextHtml = '';
        if (item.item && item.item !== item.item_normalized && !item.item.includes("PAYMENT")) {
            subtextHtml = `<div class="table-subtext">${escapeHtml(item.item)}</div>`;
        }
        
        const isCredit = item.extracted_idr < 0;
        const amtSign = isCredit ? "- " : "";
        const amtColor = isCredit ? "color: #10b981;" : "color: var(--color-expense);";

        row.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
            <td style="white-space: nowrap;">${item.tanggal}</td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item_normalized)}</div>
                ${subtextHtml}
            </td>
            <td>${getCategoryBadgeHtml(item.kategori_normalized)}</td>
            <td class="amount-col" style="font-weight: 600; ${amtColor}">${amtSign}Rp ${formatCurrency(Math.round(Math.abs(item.extracted_idr)))}</td>
            <td class="amount-col" style="font-weight: 500; ${amtColor}">${amtSign}¥${formatCurrency(Math.round(Math.abs(item.pengeluaran)))}</td>
        `;
        tableBody.appendChild(row);
    });
}

// --- Income Analyzer View Rendering ---
function updateIncomePage(filteredData) {
    const tableBody = document.getElementById("income-table-body");
    const countEl = document.getElementById("income-count");
    const kpiTotalEl = document.getElementById("kpi-income-total");
    const kpiAvgEl = document.getElementById("kpi-income-avg");
    const kpiSourceValEl = document.getElementById("kpi-income-source-val");
    const kpiSourceSubEl = document.getElementById("kpi-income-source-subtitle");

    if (!tableBody) return;

    // 1. Filter out transfers
    const incomeData = filteredData.filter(item => 
        item.pemasukan > 0 && 
        !isExcludedTransfer(item.item_normalized)
    );

    // 2. Calculate KPIs
    let totalIncome = 0;
    const sourceSums = {};
    incomeData.forEach(item => {
        totalIncome += item.pemasukan;
        sourceSums[item.kategori_normalized] = (sourceSums[item.kategori_normalized] || 0) + item.pemasukan;
    });

    const activeMonths = getUniqueMonths(filteredData);
    const avgIncome = activeMonths.length > 0 ? (totalIncome / activeMonths.length) : totalIncome;

    let topSource = "None";
    let topSourceAmt = 0;
    Object.entries(sourceSums).forEach(([src, amt]) => {
        if (amt > topSourceAmt) {
            topSourceAmt = amt;
            topSource = src;
        }
    });

    // Populate KPIs
    kpiTotalEl.textContent = formatCurrency(totalIncome);
    kpiAvgEl.textContent = formatCurrency(avgIncome);
    kpiSourceValEl.textContent = topSource;
    kpiSourceSubEl.textContent = topSourceAmt > 0 ? `¥${formatCurrency(topSourceAmt)} generated` : "No income recorded";

    // 3. Render Table
    tableBody.innerHTML = "";
    countEl.textContent = `Showing ${incomeData.length} income transactions`;

    if (incomeData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No income transactions recorded for this period.</td></tr>`;
    } else {
        // Sort descending
        const sortedIncome = [...incomeData].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        sortedIncome.forEach(item => {
            const row = document.createElement("tr");
            let subtextHtml = '';
            if (item.item !== item.item_normalized) {
                subtextHtml = `<div class="table-subtext">${escapeHtml(item.item)}</div>`;
            }
            row.innerHTML = `
                <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
                <td style="white-space: nowrap;">${item.tanggal}</td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item_normalized)}</div>
                    ${subtextHtml}
                </td>
                <td>${getCategoryBadgeHtml(item.kategori_normalized)}</td>
                <td>${item.tempat ? escapeHtml(item.tempat) : '<span style="color: var(--text-muted); font-style: italic;">N/A</span>'}</td>
                <td class="amount-col" style="font-weight: 600; color: var(--color-income);">+ ¥${formatCurrency(item.pemasukan)}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // 4. Render Charts
    const colors = getChartColors();
    renderIncomeMonthlyChart(filteredData, colors);
    renderIncomeCategoryChart(filteredData, colors);
}

function renderIncomeMonthlyChart(filteredData, colors) {
    if (incomeMonthlyChart) {
        incomeMonthlyChart.destroy();
    }

    const monthlySummary = {};
    filteredData.forEach(item => {
        if (item.pemasukan > 0 && !isExcludedTransfer(item.item_normalized)) {
            const key = `${item.tahun}-${item.bulan}`;
            monthlySummary[key] = (monthlySummary[key] || 0) + item.pemasukan;
        }
    });

    const labels = Object.keys(monthlySummary);
    const data = labels.map(l => monthlySummary[l]);
    const formattedLabels = labels.map(l => {
        const [year, month] = l.split("-");
        return `${month.substring(0,3)} ${year}`;
    });

    const ctx = document.getElementById("income-monthly-chart").getContext("2d");
    incomeMonthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: formattedLabels,
            datasets: [{
                label: 'Income (Pemasukan)',
                data: data,
                backgroundColor: '#10b981',
                borderRadius: 6,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.text, font: { family: 'Inter' } }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { 
                        color: colors.text, 
                        font: { family: 'Inter' },
                        callback: value => '¥' + formatCurrency(value)
                    }
                }
            }
        }
    });
}

function renderIncomeCategoryChart(filteredData, colors) {
    if (incomeCategoryChart) {
        incomeCategoryChart.destroy();
    }

    const categoriesSum = {};
    filteredData.forEach(item => {
        if (item.pemasukan > 0 && !isExcludedTransfer(item.item_normalized)) {
            categoriesSum[item.kategori_normalized] = (categoriesSum[item.kategori_normalized] || 0) + item.pemasukan;
        }
    });

    const sorted = Object.entries(categoriesSum).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(c => c[0]);
    const data = sorted.map(c => c[1]);

    const ctx = document.getElementById("income-category-chart").getContext("2d");
    incomeCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels.map(label => getCategoryColor(label)),
                borderWidth: document.body.classList.contains("dark-theme") ? 2 : 1,
                borderColor: document.body.classList.contains("dark-theme") ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: colors.text, font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const val = context.raw;
                            const pct = ((val / total) * 100).toFixed(1);
                            return ` ${context.label}: ¥${formatCurrency(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// --- Expense Analyzer View Rendering ---
function updateExpensePage(filteredData) {
    const tableBody = document.getElementById("expense-table-body");
    const countEl = document.getElementById("expense-count");
    const kpiTotalEl = document.getElementById("kpi-expense-total");
    const kpiAvgEl = document.getElementById("kpi-expense-avg");
    const splitCashPctEl = document.getElementById("expense-split-cash-pct");
    const splitDigitalPctEl = document.getElementById("expense-split-digital-pct");
    const splitCashBar = document.getElementById("expense-split-cash-bar");
    const splitDigitalBar = document.getElementById("expense-split-digital-bar");

    if (!tableBody) return;

    // 1. Filter out transfers
    const expenseData = filteredData.filter(item => 
        item.pengeluaran !== 0 && 
        !isExcludedTransfer(item.item_normalized)
    );

    // 2. Calculate KPIs
    let totalExpense = 0;
    let cashExp = 0;
    let digitalExp = 0;

    expenseData.forEach(item => {
        totalExpense += item.pengeluaran;
        if (item.payment_type === 'cash') {
            cashExp += item.pengeluaran;
        } else {
            digitalExp += item.pengeluaran;
        }
    });

    const activeMonths = getUniqueMonths(filteredData);
    const avgExpense = activeMonths.length > 0 ? (totalExpense / activeMonths.length) : totalExpense;

    const totalSplit = cashExp + digitalExp;
    const cashPct = totalSplit > 0 ? (cashExp / totalSplit) * 100 : 0;
    const digitalPct = totalSplit > 0 ? (digitalExp / totalSplit) * 100 : 0;

    // Populate KPIs
    kpiTotalEl.textContent = formatCurrency(totalExpense);
    kpiAvgEl.textContent = formatCurrency(avgExpense);
    splitCashPctEl.textContent = `Cash: ${cashPct.toFixed(1)}%`;
    splitDigitalPctEl.textContent = `Digital: ${digitalPct.toFixed(1)}%`;
    if (splitCashBar) splitCashBar.style.width = `${cashPct}%`;
    if (splitDigitalBar) splitDigitalBar.style.width = `${digitalPct}%`;

    // 3. Render Table
    tableBody.innerHTML = "";
    countEl.textContent = `Showing ${expenseData.length} expense transactions`;

    if (expenseData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No expense transactions recorded for this period.</td></tr>`;
    } else {
        // Sort descending
        const sortedExpense = [...expenseData].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        sortedExpense.forEach(item => {
            const row = document.createElement("tr");
            let subtextHtml = '';
            if (item.item !== item.item_normalized) {
                subtextHtml = `<div class="table-subtext">${escapeHtml(item.item)}</div>`;
            }
            if (item.note) {
                subtextHtml += `<div class="table-subtext" style="color: var(--color-primary); font-style: italic; margin-top: 2px;"><i class="fa-solid fa-sticky-note"></i> ${escapeHtml(item.note)}</div>`;
            }

            const paymentBadge = item.payment_type === 'cash'
                ? `<span class="badge badge-type-cash" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-money-bill-1"></i> Cash</span>`
                : `<span class="badge badge-type-cashless" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-credit-card"></i> Digital</span>`;

            const amtSign = item.pengeluaran < 0 ? "+ " : "- ";
            const amtColor = item.pengeluaran < 0 ? "color: #10b981;" : "color: var(--color-expense);";

            row.innerHTML = `
                <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
                <td style="white-space: nowrap;">${item.tanggal}</td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item_normalized)}</div>                    ${subtextHtml}
                </td>
                <td>${getCategoryBadgeHtml(item.kategori_normalized)}</td>
                <td>${item.tempat ? escapeHtml(item.tempat) : '<span style="color: var(--text-muted); font-style: italic;">N/A</span>'}</td>
                <td>${paymentBadge}</td>
                <td class="amount-col" style="font-weight: 600; ${amtColor}">${amtSign}¥${formatCurrency(Math.abs(item.pengeluaran))}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // 4. Render Charts
    const colors = getChartColors();
    renderExpenseMonthlyChart(filteredData, colors);
    renderExpenseCategoryChart(filteredData, colors);
}

function renderExpenseMonthlyChart(filteredData, colors) {
    if (expenseMonthlyChart) {
        expenseMonthlyChart.destroy();
    }

    const monthlySummary = {};
    filteredData.forEach(item => {
        if (item.pengeluaran !== 0 && !isExcludedTransfer(item.item_normalized)) {
            const key = `${item.tahun}-${item.bulan}`;
            monthlySummary[key] = (monthlySummary[key] || 0) + item.pengeluaran;
        }
    });

    const labels = Object.keys(monthlySummary);
    const data = labels.map(l => monthlySummary[l]);
    const formattedLabels = labels.map(l => {
        const [year, month] = l.split("-");
        return `${month.substring(0,3)} ${year}`;
    });

    const ctx = document.getElementById("expense-monthly-chart").getContext("2d");
    expenseMonthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: formattedLabels,
            datasets: [{
                label: 'Expense (Pengeluaran)',
                data: data,
                backgroundColor: '#f87171',
                borderRadius: 6,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.text, font: { family: 'Inter' } }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { 
                        color: colors.text, 
                        font: { family: 'Inter' },
                        callback: value => '¥' + formatCurrency(value)
                    }
                }
            }
        }
    });
}

function renderExpenseCategoryChart(filteredData, colors) {
    if (expenseCategoryChart) {
        expenseCategoryChart.destroy();
    }

    const categoriesSum = {};
    filteredData.forEach(item => {
        if (item.pengeluaran !== 0 && !isExcludedTransfer(item.item_normalized)) {
            categoriesSum[item.kategori_normalized] = (categoriesSum[item.kategori_normalized] || 0) + item.pengeluaran;
        }
    });

    const sorted = Object.entries(categoriesSum).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(c => c[0]);
    const data = sorted.map(c => c[1]);

    const ctx = document.getElementById("expense-category-chart").getContext("2d");
    expenseCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels.map(label => getCategoryColor(label)),
                borderWidth: document.body.classList.contains("dark-theme") ? 2 : 1,
                borderColor: document.body.classList.contains("dark-theme") ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: colors.text, font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const val = context.raw;
                            const pct = ((val / total) * 100).toFixed(1);
                            return ` ${context.label}: ¥${formatCurrency(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// --- Rent & Utilities Pages Logic ---
function updateUtilityPages(filteredData) {
    updateSingleUtilityPage(filteredData, "rent", "Apartment Rent", "#6366f1");
    updateSingleUtilityPage(filteredData, "gas", "Gas Bill", "#ef4444");
    updateSingleUtilityPage(filteredData, "electricity", "Electricity Bill", "#f59e0b");
    updateSingleUtilityPage(filteredData, "water", "Water Bill", "#06b6d4");
    updateSingleUtilityPage(filteredData, "mobile", "Mobile Bill", "#ec4899");
    updateUtilitiesOverviewPage(filteredData);
    updateAIRecommendationsPage(filteredData);
}

function getClosestUpcomingUtilityBill(filteredData) {
    const today = new Date("2026-07-09");
    const dates = [];
    
    // Rent
    const rentData = filteredData.filter(item => item.item_normalized === "Apartment Rent" && item.pengeluaran > 0);
    if (rentData.length > 0) {
        const sorted = [...rentData].sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const match = sorted[0].item.match(/\(([^)]+)\)/);
        if (match) {
            const period = match[1];
            const d = new Date(period);
            if (!isNaN(d.getTime())) {
                d.setDate(27);
                dates.push({ name: "Apartment Rent", date: d, text: "Late " + period + " (approx. 27-29th)" });
            }
        }
    }
    
    // Gas
    const gasData = filteredData.filter(item => item.item_normalized === "Gas Bill" && item.pengeluaran > 0);
    if (gasData.length > 0) {
        const sorted = [...gasData].sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const match = sorted[0].item.match(/\(([^)]+)\)/);
        if (match) {
            const period = match[1];
            const d = new Date(period);
            if (!isNaN(d.getTime())) {
                d.setMonth(d.getMonth() + 1);
                d.setDate(23);
                const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                dates.push({ name: "Gas Bill", date: d, text: `Late ${monthsList[d.getMonth()]} ${d.getFullYear()} (approx. 23-26th)` });
            }
        }
    }
    
    // Electricity
    const elecData = filteredData.filter(item => item.item_normalized === "Electricity Bill" && item.pengeluaran > 0);
    if (elecData.length > 0) {
        const sorted = [...elecData].sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const d = new Date(sorted[0].tanggal);
        if (!isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + 1);
            d.setDate(10);
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            dates.push({ name: "Electricity Bill", date: d, text: `Mid ${monthsList[d.getMonth()]} ${d.getFullYear()} (approx. 10-14th)` });
        }
    }
    
    // Water
    const waterData = filteredData.filter(item => item.item_normalized === "Water Bill" && item.pengeluaran > 0);
    if (waterData.length > 0) {
        const sorted = [...waterData].sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const d = new Date(sorted[0].tanggal);
        if (!isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + 2);
            d.setDate(1);
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            dates.push({ name: "Water Bill", date: d, text: `Early ${monthsList[d.getMonth()]} ${d.getFullYear()} (approx. 1-5th)` });
        }
    }
    
    // Mobile
    const mobileData = filteredData.filter(item => item.item_normalized === "Mobile Bill" && item.pengeluaran > 0);
    if (mobileData.length > 0) {
        const sorted = [...mobileData].sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
        const d = new Date(sorted[0].tanggal);
        if (!isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + 1);
            d.setDate(24);
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            dates.push({ name: "Mobile Bill", date: d, text: `Late ${monthsList[d.getMonth()]} ${d.getFullYear()} (approx. 24-25th)` });
        }
    }
    
    if (dates.length === 0) return "N/A";
    
    const futureDates = dates.filter(item => item.date >= today);
    const targetList = futureDates.length > 0 ? futureDates : dates;
    targetList.sort((a,b) => a.date - b.date);
    return `${targetList[0].name}: ${targetList[0].text}`;
}

function updateUtilitiesOverviewPage(filteredData) {
    const tableBody = document.getElementById("utilities-overview-table-body");
    const countEl = document.getElementById("utilities-count-text");
    const kpiTotalEl = document.getElementById("kpi-utilities-total");
    const kpiAvgEl = document.getElementById("kpi-utilities-avg");
    const kpiLastDateEl = document.getElementById("kpi-utilities-last-date");
    const kpiNextExpectedEl = document.getElementById("kpi-utilities-next-expected");

    if (!tableBody) return;

    const rentData = filteredData.filter(item => item.item_normalized === "Apartment Rent" && item.pengeluaran > 0);
    const gasData = filteredData.filter(item => item.item_normalized === "Gas Bill" && item.pengeluaran > 0);
    const elecData = filteredData.filter(item => item.item_normalized === "Electricity Bill" && item.pengeluaran > 0);
    const waterData = filteredData.filter(item => item.item_normalized === "Water Bill" && item.pengeluaran > 0);
    const mobileData = filteredData.filter(item => item.item_normalized === "Mobile Bill" && item.pengeluaran > 0);

    const allUtilities = [...rentData, ...gasData, ...elecData, ...waterData, ...mobileData];

    let totalPaid = 0;
    allUtilities.forEach(item => {
        totalPaid += item.pengeluaran;
    });

    const monthlySummary = {};
    allUtilities.forEach(item => {
        const key = `${item.tahun}-${item.bulan}`;
        if (!monthlySummary[key]) {
            monthlySummary[key] = { rent: 0, gas: 0, electricity: 0, water: 0, mobile: 0, total: 0 };
        }
        if (item.item_normalized === "Apartment Rent") monthlySummary[key].rent += item.pengeluaran;
        else if (item.item_normalized === "Gas Bill") monthlySummary[key].gas += item.pengeluaran;
        else if (item.item_normalized === "Electricity Bill") monthlySummary[key].electricity += item.pengeluaran;
        else if (item.item_normalized === "Water Bill") monthlySummary[key].water += item.pengeluaran;
        else if (item.item_normalized === "Mobile Bill") monthlySummary[key].mobile += item.pengeluaran;
        monthlySummary[key].total += item.pengeluaran;
    });

    const uniqueMonthsList = Object.keys(monthlySummary);
    const avgPaid = uniqueMonthsList.length > 0 ? (totalPaid / uniqueMonthsList.length) : 0;

    let lastDate = "N/A";
    if (allUtilities.length > 0) {
        const sortedDates = [...allUtilities].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        lastDate = sortedDates[0].tanggal;
    }

    const nextExpected = getClosestUpcomingUtilityBill(filteredData);

    if (kpiTotalEl) kpiTotalEl.textContent = formatCurrency(totalPaid);
    if (kpiAvgEl) kpiAvgEl.textContent = formatCurrency(avgPaid);
    if (kpiLastDateEl) kpiLastDateEl.textContent = lastDate;
    if (kpiNextExpectedEl) kpiNextExpectedEl.textContent = nextExpected;

    tableBody.innerHTML = "";
    if (countEl) countEl.textContent = `Showing ${uniqueMonthsList.length} months`;

    const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const sortedMonthsDesc = [...uniqueMonthsList].sort((a, b) => {
        const [yA, mA] = a.split("-");
        const [yB, mB] = b.split("-");
        if (yA !== yB) return yB - yA;
        return monthsOrder.indexOf(mB) - monthsOrder.indexOf(mA);
    });

    if (sortedMonthsDesc.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No payments recorded for this period.</td></tr>`;
    } else {
        sortedMonthsDesc.forEach(monthKey => {
            const data = monthlySummary[monthKey];
            const row = document.createElement("tr");
            row.innerHTML = `
                <td style="font-weight: 600; color: var(--text-primary);">${monthKey}</td>
                <td>¥${formatCurrency(data.rent)}</td>
                <td>¥${formatCurrency(data.gas)}</td>
                <td>¥${formatCurrency(data.electricity)}</td>
                <td>¥${formatCurrency(data.water)}</td>
                <td>¥${formatCurrency(data.mobile)}</td>
                <td class="amount-col" style="font-weight: 700; color: var(--text-primary);">¥${formatCurrency(data.total)}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    renderUtilitiesOverviewChart(monthlySummary);
}

function renderUtilitiesOverviewChart(monthlySummary) {
    const canvas = document.getElementById("utilities-overview-chart");
    if (!canvas) return;

    if (utilitiesOverviewChart) {
        utilitiesOverviewChart.destroy();
    }

    const uniqueMonthsList = Object.keys(monthlySummary);
    const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const sortedMonthsAsc = [...uniqueMonthsList].sort((a, b) => {
        const [yA, mA] = a.split("-");
        const [yB, mB] = b.split("-");
        if (yA !== yB) return yA - yB;
        return monthsOrder.indexOf(mA) - monthsOrder.indexOf(mB);
    });

    const labels = [];
    const rentData = [];
    const gasData = [];
    const electricityData = [];
    const waterData = [];
    const mobileData = [];

    sortedMonthsAsc.forEach(key => {
        const [year, month] = key.split("-");
        const shortMonth = month.substring(0, 3);
        labels.push(`${shortMonth} ${year}`);

        const data = monthlySummary[key];
        rentData.push(data.rent);
        gasData.push(data.gas);
        electricityData.push(data.electricity);
        waterData.push(data.water);
        mobileData.push(data.mobile || 0);
    });

    const ctx = canvas.getContext("2d");
    utilitiesOverviewChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Apartment Rent',
                    data: rentData,
                    backgroundColor: '#6366f1',
                    borderRadius: 4
                },
                {
                    label: 'Gas Bill',
                    data: gasData,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                },
                {
                    label: 'Electricity Bill',
                    data: electricityData,
                    backgroundColor: '#f59e0b',
                    borderRadius: 4
                },
                {
                    label: 'Water Bill',
                    data: waterData,
                    backgroundColor: '#06b6d4',
                    borderRadius: 4
                },
                {
                    label: 'Mobile Bill',
                    data: mobileData,
                    backgroundColor: '#ec4899',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { family: 'Outfit' } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(148, 163, 184, 0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(148, 163, 184, 0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                }
            }
        }
    });
}

// --- AI Recommendations & Budget Simulator ---
let simBaselineIncome = 145000;
let simBaselineRent = 45228;
let simBaselineUtilities = 7377;

function updateAIRecommendationsPage(filteredData) {
    const incomeData = filteredData.filter(item => item.pemasukan > 0 && !isExcludedTransfer(item.item_normalized));
    const totalIncome = incomeData.reduce((sum, item) => sum + item.pemasukan, 0);

    const expenseData = filteredData.filter(item => item.pengeluaran > 0 && !isExcludedTransfer(item.item_normalized));
    const totalExpense = expenseData.reduce((sum, item) => sum + item.pengeluaran, 0);

    const activeMonths = getUniqueMonths(filteredData);
    const monthsCount = activeMonths.length || 1;

    const rentData = filteredData.filter(item => item.item_normalized === "Apartment Rent" && item.pengeluaran > 0);
    const gasData = filteredData.filter(item => item.item_normalized === "Gas Bill" && item.pengeluaran > 0);
    const elecData = filteredData.filter(item => item.item_normalized === "Electricity Bill" && item.pengeluaran > 0);
    const waterData = filteredData.filter(item => item.item_normalized === "Water Bill" && item.pengeluaran > 0);
    const mobileData = filteredData.filter(item => item.item_normalized === "Mobile Bill" && item.pengeluaran > 0);

    const rentTotal = rentData.reduce((sum, item) => sum + item.pengeluaran, 0);
    const gasTotal = gasData.reduce((sum, item) => sum + item.pengeluaran, 0);
    const elecTotal = elecData.reduce((sum, item) => sum + item.pengeluaran, 0);
    const waterTotal = waterData.reduce((sum, item) => sum + item.pengeluaran, 0);
    const mobileTotal = mobileData.reduce((sum, item) => sum + item.pengeluaran, 0);

    const avgRent = rentTotal / monthsCount;
    const avgGas = gasTotal / monthsCount;
    const avgElec = elecTotal / monthsCount;
    const avgWater = waterTotal / monthsCount;
    const avgMobile = mobileTotal / monthsCount;
    const avgUtilitiesCombined = avgGas + avgElec + avgWater + avgMobile;

    simBaselineRent = avgRent || 45228;
    simBaselineUtilities = avgUtilitiesCombined || 7377;
    simBaselineIncome = (totalIncome / monthsCount) || 145000;

    const savings = totalIncome - totalExpense;
    let savingsRate = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;
    if (savingsRate < 0) savingsRate = 0;

    let healthScore = 70;
    if (savingsRate >= 35) healthScore += 15;
    else if (savingsRate >= 20) healthScore += 10;
    else if (savingsRate >= 5) healthScore += 5;
    else if (savingsRate <= 0) healthScore -= 15;

    const rentToIncomeRatio = totalIncome > 0 ? (rentTotal / totalIncome) * 100 : 0;
    if (rentToIncomeRatio > 0 && rentToIncomeRatio <= 30) healthScore += 10;
    else if (rentToIncomeRatio > 0 && rentToIncomeRatio <= 35) healthScore += 5;
    else if (rentToIncomeRatio > 35) healthScore -= 10;

    const hasSpayLater = filteredData.some(item => item.item_normalized && item.item_normalized.includes("SPayLater"));
    if (hasSpayLater) healthScore -= 5;

    healthScore = Math.max(30, Math.min(100, healthScore));

    const scoreEl = document.getElementById("ai-health-score");
    const circleEl = document.getElementById("ai-health-circle");
    if (scoreEl) scoreEl.textContent = healthScore;
    if (circleEl) {
        circleEl.style.background = `conic-gradient(var(--accent-pink) 0% ${healthScore}%, rgba(255,255,255,0.1) ${healthScore}% 100%)`;
    }

    const voiceEl = document.getElementById("ai-advisor-voice");
    if (voiceEl) {
        if (totalIncome === 0) {
            voiceEl.innerHTML = "Hello Arif! Please select a wider timeline or filters that contain income records. I need income data to perform a complete advisor diagnostics scan.";
        } else if (savings < 0) {
            voiceEl.innerHTML = `Hello Arif! Your overall financial health is **concerning (${healthScore}/100)**. In this period, your outflows exceeded your income by **¥${Math.abs(savings).toLocaleString(undefined, {maximumFractionDigits:0})}**. I highly recommend reducing discretionary shopping, avoiding new card installments, and setting hard daily spending caps to regain balance.`;
        } else {
            voiceEl.innerHTML = `Hello Arif! Your overall financial health is **strong (${healthScore}/100)**. You saved **¥${savings.toLocaleString(undefined, {maximumFractionDigits:0})}** (or **${savingsRate.toFixed(1)}%** of your total inflows) during this period. I have compiled critical insights below to help you optimize your apartment rent, summer utilities, and card payments.`;
        }
    }

    updateSimulator();
}

function initAISimulator() {
    const sliderGroceries = document.getElementById("slider-groceries");
    const sliderDining = document.getElementById("slider-dining");
    const sliderDiscretionary = document.getElementById("slider-discretionary");

    if (!sliderGroceries) return;

    const handler = () => {
        updateSimulator();
    };

    sliderGroceries.addEventListener("input", handler);
    sliderDining.addEventListener("input", handler);
    sliderDiscretionary.addEventListener("input", handler);
}

function updateSimulator() {
    const sliderGroceries = document.getElementById("slider-groceries");
    const sliderDining = document.getElementById("slider-dining");
    const sliderDiscretionary = document.getElementById("slider-discretionary");

    if (!sliderGroceries) return;

    const valGroceries = parseInt(sliderGroceries.value);
    const valDining = parseInt(sliderDining.value);
    const valDiscretionary = parseInt(sliderDiscretionary.value);

    document.getElementById("val-groceries").textContent = `¥${valGroceries.toLocaleString()}`;
    document.getElementById("val-dining").textContent = `¥${valDining.toLocaleString()}`;
    document.getElementById("val-discretionary").textContent = `¥${valDiscretionary.toLocaleString()}`;

    const simRent = simBaselineRent || 45228;
    const simUtilities = simBaselineUtilities || 7377;
    const simIncome = simBaselineIncome || 145000;

    const simulatedTotalOutflow = simRent + simUtilities + valGroceries + valDining + valDiscretionary;
    const simulatedSavings = simIncome - simulatedTotalOutflow;
    const simulatedSavingsRate = simIncome > 0 ? (simulatedSavings / simIncome) * 100 : 0;

    const rateEl = document.getElementById("sim-savings-rate");
    const amtEl = document.getElementById("sim-savings-amount");
    const commentEl = document.getElementById("sim-commentary");

    if (rateEl) {
        rateEl.textContent = `${simulatedSavingsRate.toFixed(1)}%`;
        if (simulatedSavingsRate < 0) {
            rateEl.style.color = "var(--color-expense)";
        } else {
            rateEl.style.color = "#10b981";
        }
    }

    if (amtEl) {
        amtEl.textContent = `¥${simulatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        if (simulatedSavings < 0) {
            amtEl.style.color = "var(--color-expense)";
        } else {
            amtEl.style.color = "var(--text-primary)";
        }
    }

    if (commentEl) {
        if (simulatedSavingsRate >= 35) {
            commentEl.textContent = `Outstanding! A simulated savings rate of ${simulatedSavingsRate.toFixed(1)}% is highly secure. You will save approximately ¥${simulatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} monthly, allowing you to quickly accumulate a solid cash buffer.`;
        } else if (simulatedSavingsRate >= 20) {
            commentEl.textContent = `Sufficient & Sustainable. You will save ¥${simulatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} monthly (${simulatedSavingsRate.toFixed(1)}%). This budget fits a healthy student lifestyle while maintaining emergency reserves.`;
        } else if (simulatedSavingsRate >= 0) {
            commentEl.textContent = `Tight budget warning. You will save only ¥${simulatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} monthly (${simulatedSavingsRate.toFixed(1)}%). We suggest lowering your Entertainment or Discretionary sliders by ¥5,000 to improve financial headroom.`;
        } else {
            commentEl.textContent = `Monthly Deficit! Under this simulation, you are spending ¥${Math.abs(simulatedSavings).toLocaleString(undefined, {maximumFractionDigits: 0})} beyond your scholarship. Please lower your spending targets immediately to avoid drawing down savings.`;
        }
    }
}

function getNextBillingExpected(itemText, dateStr, prefix) {
    if (prefix === 'rent') {
        const match = itemText.match(/\(([^)]+)\)/);
        if (match) {
            const period = match[1];
            return `Late ${period} (approx. 27-29th)`;
        }
        return "Late next month";
    } else if (prefix === 'gas') {
        const match = itemText.match(/\(([^)]+)\)/);
        if (match) {
            const period = match[1];
            const [mStr, yStr] = period.split(" ");
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            let idx = monthsList.indexOf(mStr);
            if (idx === -1) idx = fullMonths.indexOf(mStr);
            if (idx !== -1) {
                let nextIdx = (idx + 1) % 12;
                let year = parseInt(yStr);
                if (nextIdx === 0) year += 1;
                const nextMonth = monthsList[nextIdx];
                return `Late ${nextMonth} ${year} (approx. 23-26th)`;
            }
        }
        return "Late next month";
    } else if (prefix === 'electricity') {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            const nextDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `Mid ${monthsList[nextDate.getMonth()]} ${nextDate.getFullYear()} (approx. 10-14th)`;
        }
        return "Mid next month";
    } else if (prefix === 'water') {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            const nextDate = new Date(date.getFullYear(), date.getMonth() + 2, 1);
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `Early ${monthsList[nextDate.getMonth()]} ${nextDate.getFullYear()} (approx. 1-5th)`;
        }
        return "Bi-monthly (approx. 2 months)";
    } else if (prefix === 'mobile') {
        const match = itemText.match(/\(([^)]+)\)/);
        if (match) {
            const period = match[1];
            const [mStr, yStr] = period.split(" ");
            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            let idx = monthsList.indexOf(mStr);
            if (idx === -1) idx = fullMonths.indexOf(mStr);
            if (idx !== -1) {
                let nextIdx = (idx + 1) % 12;
                let year = parseInt(yStr);
                if (nextIdx === 0) year += 1;
                const nextMonth = monthsList[nextIdx];
                return `Late ${nextMonth} ${year} (approx. 24-25th)`;
            }
        }
        return "Late next month";
    }
    return "N/A";
}

function updateSingleUtilityPage(filteredData, prefix, targetItemNormalized, colorHex) {
    const tableBody = document.getElementById(`${prefix}-table-body`);
    const countEl = document.getElementById(`${prefix}-count`);
    const kpiTotalEl = document.getElementById(`kpi-${prefix}-total`);
    const kpiAvgEl = document.getElementById(`kpi-${prefix}-avg`);
    const kpiLastDateEl = document.getElementById(`kpi-${prefix}-last-date`);
    const kpiNextExpectedEl = document.getElementById(`kpi-${prefix}-next-expected`);

    if (!tableBody) return;

    // Filter matching transactions
    const utilityData = filteredData.filter(item => 
        item.item_normalized === targetItemNormalized && item.pengeluaran > 0
    );

    // Calculate KPIs
    let totalPaid = 0;
    utilityData.forEach(item => {
        totalPaid += item.pengeluaran;
    });

    const uniqueMonths = Array.from(new Set(utilityData.map(item => `${item.tahun}-${item.bulan}`)));
    const avgPaid = uniqueMonths.length > 0 ? (totalPaid / uniqueMonths.length) : 0;

    let lastDate = "N/A";
    let nextExpected = "N/A";
    if (utilityData.length > 0) {
        // Find most recent date
        const sortedDates = [...utilityData].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        const latestItem = sortedDates[0];
        lastDate = latestItem.tanggal;
        nextExpected = getNextBillingExpected(latestItem.item, latestItem.tanggal, prefix);
    }

    // Populate KPIs
    if (kpiTotalEl) kpiTotalEl.textContent = formatCurrency(totalPaid);
    if (kpiAvgEl) kpiAvgEl.textContent = formatCurrency(avgPaid);
    if (kpiLastDateEl) kpiLastDateEl.textContent = lastDate;
    if (kpiNextExpectedEl) kpiNextExpectedEl.textContent = nextExpected;

    // Render Table
    tableBody.innerHTML = "";
    if (countEl) countEl.textContent = `Showing ${utilityData.length} payments`;

    if (utilityData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">No payments recorded for this period.</td></tr>`;
    } else {
        const sortedData = [...utilityData].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
        sortedData.forEach(item => {
            const row = document.createElement("tr");
            let subtextHtml = '';
            if (item.note) {
                subtextHtml = `<div class="table-subtext" style="color: var(--color-primary); font-style: italic; margin-top: 2px;"><i class="fa-solid fa-sticky-note"></i> ${escapeHtml(item.note)}</div>`;
            }

            const paymentBadge = item.payment_type === 'cash'
                ? `<span class="badge badge-type-cash" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-money-bill-1"></i> Cash</span>`
                : `<span class="badge badge-type-cashless" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;"><i class="fa-solid fa-credit-card"></i> Digital</span>`;

            row.innerHTML = `
                <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${item.id}</td>
                <td style="white-space: nowrap;">${item.tanggal}</td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.item)}</div>
                    ${subtextHtml}
                </td>
                <td>${paymentBadge}</td>
                <td class="amount-col" style="font-weight: 600; color: var(--color-expense);">- ¥${formatCurrency(item.pengeluaran)}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Render Monthly Trend Line Chart
    renderUtilityChart(prefix, utilityData, colorHex);
}

function renderUtilityChart(prefix, utilityData, colorHex) {
    let chartInstanceVarName = `${prefix}TrendChart`;
    let chartInstance = window[chartInstanceVarName] || null;

    if (chartInstance) {
        chartInstance.destroy();
    }

    // Group by YearMonth
    const monthlySummary = {};
    utilityData.forEach(item => {
        const key = `${item.tahun}-${item.bulan}`;
        monthlySummary[key] = (monthlySummary[key] || 0) + item.pengeluaran;
    });

    // Sort labels chronologically
    const sortedKeys = Object.keys(monthlySummary).sort((a, b) => {
        const [yA, mA] = a.split("-");
        const [yB, mB] = b.split("-");
        const monthsList = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        if (yA !== yB) return yA - yB;
        return monthsList.indexOf(mA) - monthsList.indexOf(mB);
    });

    const labels = sortedKeys;
    const data = labels.map(l => monthlySummary[l]);
    const formattedLabels = labels.map(l => {
        const [year, month] = l.split("-");
        return `${month.substring(0,3)} ${year}`;
    });

    const canvas = document.getElementById(`${prefix}-trend-chart`);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const colors = getChartColors();

    const newChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: [{
                label: 'Amount Paid (¥)',
                data: data,
                borderColor: colorHex,
                backgroundColor: colorHex + '1A', // 10% opacity fill
                fill: true,
                tension: 0.3,
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: colorHex
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.text,
                    bodyColor: colors.text,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` ¥${formatCurrency(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: colors.text, font: { family: 'Inter' } }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: {
                        color: colors.text,
                        font: { family: 'Inter' },
                        callback: function(value) {
                            return '¥' + formatCurrency(value);
                        }
                    }
                }
            }
        }
    });

    // Save chart instance to global scope so navigation resize works
    window[chartInstanceVarName] = newChart;
    
    // Explicitly update the global variables as well
    if (prefix === "rent") rentTrendChart = newChart;
    else if (prefix === "gas") gasTrendChart = newChart;
    else if (prefix === "electricity") electricityTrendChart = newChart;
    else if (prefix === "water") waterTrendChart = newChart;
    else if (prefix === "mobile") mobileTrendChart = newChart;
}

// --- BNI Account Tracker Logic ---
function initBniAccountTracker() {
    const bniSelect = document.getElementById("bni-statement-select");
    if (!bniSelect) return;
    
    // Find unique periods in reverse chronological order
    const uniquePeriods = [];
    bniData.forEach(tx => {
        const period = `${tx.month} ${tx.year}`;
        if (!uniquePeriods.includes(period)) {
            uniquePeriods.push(period);
        }
    });
    
    const monthIndices = {
        "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
        "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
    };
    
    uniquePeriods.sort((a, b) => {
        const [m1, y1] = a.split(" ");
        const [m2, y2] = b.split(" ");
        if (y1 !== y2) return parseInt(y2) - parseInt(y1);
        return monthIndices[m2] - monthIndices[m1];
    });
    
    bniSelect.innerHTML = "";
    uniquePeriods.forEach(period => {
        const opt = document.createElement("option");
        opt.value = period;
        opt.textContent = period;
        bniSelect.appendChild(opt);
    });
    
    bniSelect.addEventListener("change", () => {
        updateBniAccountView();
    });
    
    const bniType = document.getElementById("bni-type-select");
    if (bniType) {
        bniType.addEventListener("change", () => {
            updateBniAccountView();
        });
    }
    
    const bniSearch = document.getElementById("bni-search-input");
    if (bniSearch) {
        bniSearch.addEventListener("input", () => {
            updateBniAccountView();
        });
    }
    
    updateBniAccountView();
}

function updateBniAccountView() {
    const bniSelect = document.getElementById("bni-statement-select");
    const tbody = document.getElementById("bni-table-body");
    const countEl = document.getElementById("bni-transaction-count");
    const bniTypeSelect = document.getElementById("bni-type-select");
    const bniSearchInput = document.getElementById("bni-search-input");
    
    if (!bniSelect || !tbody) return;
    
    const selectedPeriod = bniSelect.value;
    if (!selectedPeriod) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-table-msg">No statement selected.</td></tr>`;
        return;
    }
    
    // Base dataset for the month (used for statement KPIs)
    const monthTxs = bniData.filter(tx => `${tx.month} ${tx.year}` === selectedPeriod);
    
    // Filter dataset by type and search query
    let filteredTxs = [...monthTxs];
    
    if (bniTypeSelect && bniTypeSelect.value !== "all") {
        filteredTxs = filteredTxs.filter(tx => tx.type === bniTypeSelect.value);
    }
    
    if (bniSearchInput && bniSearchInput.value.trim() !== "") {
        const query = bniSearchInput.value.toLowerCase().trim();
        filteredTxs = filteredTxs.filter(tx => 
            tx.description.toLowerCase().includes(query) || 
            (tx.type && tx.type.toLowerCase().includes(query))
        );
    }
    
    if (countEl) {
        countEl.textContent = `${filteredTxs.length} transactions`;
    }
    
    // Compute KPIs
    let totalInflow = 0;
    let totalOutflow = 0;
    monthTxs.forEach(tx => {
        if (tx.sign === "+") {
            totalInflow += tx.amount;
        } else {
            totalOutflow += tx.amount;
        }
    });
    
    const endingBalance = monthTxs.length > 0 ? monthTxs[monthTxs.length - 1].balance : 0;
    const netFlow = totalInflow - totalOutflow;
    
    const rate = getExchangeRate();
    const endingBalanceJpy = endingBalance / rate;
    const totalInflowJpy = totalInflow / rate;
    const totalOutflowJpy = totalOutflow / rate;
    const netFlowJpy = netFlow / rate;
    
    // Update scorecards
    const balIdrEl = document.getElementById("kpi-bni-balance-idr");
    const balJpyEl = document.getElementById("kpi-bni-balance-jpy");
    const infIdrEl = document.getElementById("kpi-bni-inflow-idr");
    const infJpyEl = document.getElementById("kpi-bni-inflow-jpy");
    const outIdrEl = document.getElementById("kpi-bni-outflow-idr");
    const outJpyEl = document.getElementById("kpi-bni-outflow-jpy");
    const netIdrEl = document.getElementById("kpi-bni-netflow-idr");
    const netJpyEl = document.getElementById("kpi-bni-netflow-jpy");
    
    if (balIdrEl) balIdrEl.textContent = formatCurrency(Math.round(endingBalance));
    if (balJpyEl) balJpyEl.textContent = formatCurrency(Math.round(endingBalanceJpy));
    if (infIdrEl) infIdrEl.textContent = formatCurrency(Math.round(totalInflow));
    if (infJpyEl) infJpyEl.textContent = formatCurrency(Math.round(totalInflowJpy));
    if (outIdrEl) outIdrEl.textContent = formatCurrency(Math.round(totalOutflow));
    if (outJpyEl) outJpyEl.textContent = formatCurrency(Math.round(totalOutflowJpy));
    if (netIdrEl) netIdrEl.textContent = (netFlow >= 0 ? "+" : "") + formatCurrency(Math.round(netFlow));
    if (netJpyEl) netJpyEl.textContent = (netFlowJpy >= 0 ? "+" : "") + formatCurrency(Math.round(netFlowJpy));
    
    const netFlowCard = document.querySelector(".card-bni-netflow");
    if (netFlowCard) {
        if (netFlow >= 0) {
            netFlowCard.style.setProperty("--color-cc", "#10b981");
            netFlowCard.style.setProperty("--color-cc-glow", "rgba(16, 185, 129, 0.15)");
        } else {
            netFlowCard.style.setProperty("--color-cc", "#ef4444");
            netFlowCard.style.setProperty("--color-cc-glow", "rgba(239, 68, 68, 0.15)");
        }
    }
    
    // Draw/update BNI Charts
    updateBniCharts(monthTxs, filteredTxs);
    
    // Render rows
    tbody.innerHTML = "";
    if (filteredTxs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-table-msg">No transactions found for this period matching filters.</td></tr>`;
        return;
    }
    
    const reversedTxs = [...filteredTxs].reverse();
    reversedTxs.forEach(tx => {
        const tr = document.createElement("tr");
        
        let badgeColor = "#64748b"; // default slate
        if (tx.sign === "+") {
            badgeColor = "#10b981"; // green
        } else {
            if (tx.type === "Virtual Account") badgeColor = "#8b5cf6"; // purple
            else if (tx.type === "Pembayaran Qris") badgeColor = "#ec4899"; // pink
            else if (tx.type === "Ewallet") badgeColor = "#06b6d4"; // cyan
            else if (tx.type === "Tarik Tunai") badgeColor = "#f59e0b"; // amber
            else if (tx.type === "Transfer") badgeColor = "#3b82f6"; // blue
            else badgeColor = "#ef4444"; // red
        }
        
        const typeBadge = `<span style="background: ${badgeColor}20; color: ${badgeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${escapeHtml(tx.type || 'Other')}</span>`;
        
        const parts = tx.date.split("-");
        const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]} ${tx.time ? tx.time.split(" ")[0] : ""}`;
        
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">${formattedDate}</td>
            <td>${typeBadge}</td>            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(tx.description)}</div>
            </td>
            <td class="amount-col" style="color: ${tx.sign === '+' ? '#10b981' : 'var(--text-primary)'}; font-weight: 500;">
                ${tx.sign}Rp ${formatCurrency(Math.round(tx.amount))}
            </td>
            <td class="amount-col" style="color: var(--text-muted); font-size: 0.85rem;">
                ~ ¥${formatCurrency(Math.round(tx.amount_jpy))}
            </td>
            <td class="amount-col" style="font-family: monospace; font-weight: 500;">
                Rp ${formatCurrency(Math.round(tx.balance))}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateBniCharts(monthTxs, filteredTxs) {
    // --- Chart 1: Monthly Inflow vs Outflow (Trend) ---
    const trendCtx = document.getElementById("bni-trend-chart");
    if (trendCtx) {
        // Aggregate inflow/outflow per month from the entire dataset
        const monthlyData = {};
        bniData.forEach(tx => {
            const key = `${tx.month} ${tx.year}`;
            if (!monthlyData[key]) {
                monthlyData[key] = { inflow: 0, outflow: 0 };
            }
            if (tx.sign === "+") {
                monthlyData[key].inflow += tx.amount;
            } else {
                monthlyData[key].outflow += tx.amount;
            }
        });
        
        // Sort periods chronologically
        const monthIndices = {
            "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
            "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
        };
        const sortedPeriods = Object.keys(monthlyData).sort((a, b) => {
            const [m1, y1] = a.split(" ");
            const [m2, y2] = b.split(" ");
            if (y1 !== y2) return parseInt(y1) - parseInt(y2);
            return monthIndices[m1] - monthIndices[m2];
        });
        
        const labels = sortedPeriods;
        const inflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].inflow / 1000)); // in thousands
        const outflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].outflow / 1000));
        
        if (bniTrendChart) {
            bniTrendChart.destroy();
        }
        
        const isDark = document.body.classList.contains("dark-theme");
        const textCol = isDark ? "#94a3b8" : "#475569";
        const gridCol = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.05)";
        
        bniTrendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Inflows (Deposits)',
                        data: inflowValues,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: 'Outflows (Spendings)',
                        data: outflowValues,
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        borderColor: '#ef4444',
                        borderWidth: 1.5,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textCol, font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': Rp ' + formatCurrency(context.raw * 1000);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textCol, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: gridCol },
                        ticks: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) {
                                return 'Rp ' + formatCurrency(value) + 'k';
                            }
                        }
                    }
                }
            }
        });
    }

    // --- Chart 2: Outflow Breakdown by Transaction Type ---
    const typeCtx = document.getElementById("bni-type-chart");
    if (typeCtx) {
        const typeAgg = {};
        
        // We only aggregate outflows (sign === "-")
        monthTxs.forEach(tx => {
            if (tx.sign === "-") {
                const t = tx.type || "Other";
                typeAgg[t] = (typeAgg[t] || 0) + tx.amount;
            }
        });
        
        const labels = Object.keys(typeAgg);
        const values = Object.values(typeAgg).map(val => Math.round(val));
        
        const typeColors = {
            "Transfer": "#3b82f6",         // Blue
            "Tarik Tunai": "#f59e0b",       // Amber
            "Pembayaran Qris": "#ec4899",   // Pink
            "Ewallet": "#06b6d4",           // Cyan
            "Virtual Account": "#8b5cf6",   // Purple
            "Biaya": "#64748b",             // Slate
            "Other": "#94a3b8"
        };
        
        const colors = labels.map(l => typeColors[l] || "#64748b");
        
        if (bniTypeChart) {
            bniTypeChart.destroy();
        }
        
        if (labels.length === 0) {
            const isDark = document.body.classList.contains("dark-theme");
            bniTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: ['No Outflows'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        } else {
            const isDark = document.body.classList.contains("dark-theme");
            const textCol = isDark ? "#94a3b8" : "#475569";
            
            bniTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            data: values,
                            backgroundColor: colors,
                            borderWidth: isDark ? 2 : 1,
                            borderColor: isDark ? '#121621' : '#ffffff'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: textCol,
                                font: { family: 'Inter', size: 10 },
                                boxWidth: 12,
                                padding: 10
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ' ' + context.label + ': Rp ' + formatCurrency(context.raw);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
}

// --- Muamalat Account Tracker Logic ---
function initMuamalatAccountTracker() {
    const muamalatSelect = document.getElementById("muamalat-statement-select");
    if (!muamalatSelect) return;
    
    // Find unique periods in reverse chronological order
    const uniquePeriods = [];
    muamalatData.forEach(tx => {
        const period = `${tx.month} ${tx.year}`;
        if (!uniquePeriods.includes(period)) {
            uniquePeriods.push(period);
        }
    });
    
    const monthIndices = {
        "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
        "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
    };
    
    uniquePeriods.sort((a, b) => {
        const [m1, y1] = a.split(" ");
        const [m2, y2] = b.split(" ");
        if (y1 !== y2) return parseInt(y2) - parseInt(y1);
        return monthIndices[m2] - monthIndices[m1];
    });
    
    muamalatSelect.innerHTML = "";
    uniquePeriods.forEach(period => {
        const opt = document.createElement("option");
        opt.value = period;
        opt.textContent = period;
        muamalatSelect.appendChild(opt);
    });
    
    muamalatSelect.addEventListener("change", () => {
        updateMuamalatAccountView();
    });
    
    const muamalatType = document.getElementById("muamalat-type-select");
    if (muamalatType) {
        muamalatType.addEventListener("change", () => {
            updateMuamalatAccountView();
        });
    }
    
    const muamalatSearch = document.getElementById("muamalat-search-input");
    if (muamalatSearch) {
        muamalatSearch.addEventListener("input", () => {
            updateMuamalatAccountView();
        });
    }
    
    updateMuamalatAccountView();
}

function updateMuamalatAccountView() {
    const muamalatSelect = document.getElementById("muamalat-statement-select");
    const tbody = document.getElementById("muamalat-table-body");
    const countEl = document.getElementById("muamalat-transaction-count");
    const muamalatTypeSelect = document.getElementById("muamalat-type-select");
    const muamalatSearchInput = document.getElementById("muamalat-search-input");
    
    if (!muamalatSelect || !tbody) return;
    
    const selectedPeriod = muamalatSelect.value;
    if (!selectedPeriod) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-table-msg">No statement selected.</td></tr>`;
        return;
    }
    
    // Base dataset for the month (used for statement KPIs)
    const monthTxs = muamalatData.filter(tx => `${tx.month} ${tx.year}` === selectedPeriod);
    
    // Filter dataset by type and search query
    let filteredTxs = [...monthTxs];
    
    if (muamalatTypeSelect && muamalatTypeSelect.value !== "all") {
        filteredTxs = filteredTxs.filter(tx => tx.type === muamalatTypeSelect.value);
    }
    
    if (muamalatSearchInput && muamalatSearchInput.value.trim() !== "") {
        const query = muamalatSearchInput.value.toLowerCase().trim();
        filteredTxs = filteredTxs.filter(tx => 
            tx.description.toLowerCase().includes(query) || 
            (tx.type && tx.type.toLowerCase().includes(query))
        );
    }
    
    if (countEl) {
        countEl.textContent = `${filteredTxs.length} transactions`;
    }
    
    // Compute KPIs
    let totalInflow = 0;
    let totalOutflow = 0;
    monthTxs.forEach(tx => {
        if (tx.sign === "+") {
            totalInflow += tx.amount;
        } else {
            totalOutflow += tx.amount;
        }
    });
    
    const endingBalance = monthTxs.length > 0 ? monthTxs[monthTxs.length - 1].balance : 0;
    const netFlow = totalInflow - totalOutflow;
    
    const rate = getExchangeRate();
    const endingBalanceJpy = endingBalance / rate;
    const totalInflowJpy = totalInflow / rate;
    const totalOutflowJpy = totalOutflow / rate;
    const netFlowJpy = netFlow / rate;
    
    // Update scorecards
    const balIdrEl = document.getElementById("kpi-muamalat-balance-idr");
    const balJpyEl = document.getElementById("kpi-muamalat-balance-jpy");
    const infIdrEl = document.getElementById("kpi-muamalat-inflow-idr");
    const infJpyEl = document.getElementById("kpi-muamalat-inflow-jpy");
    const outIdrEl = document.getElementById("kpi-muamalat-outflow-idr");
    const outJpyEl = document.getElementById("kpi-muamalat-outflow-jpy");
    const netIdrEl = document.getElementById("kpi-muamalat-netflow-idr");
    const netJpyEl = document.getElementById("kpi-muamalat-netflow-jpy");
    
    if (balIdrEl) balIdrEl.textContent = formatCurrency(Math.round(endingBalance));
    if (balJpyEl) balJpyEl.textContent = formatCurrency(Math.round(endingBalanceJpy));
    if (infIdrEl) infIdrEl.textContent = formatCurrency(Math.round(totalInflow));
    if (infJpyEl) infJpyEl.textContent = formatCurrency(Math.round(totalInflowJpy));
    if (outIdrEl) outIdrEl.textContent = formatCurrency(Math.round(totalOutflow));
    if (outJpyEl) outJpyEl.textContent = formatCurrency(Math.round(totalOutflowJpy));
    if (netIdrEl) netIdrEl.textContent = (netFlow >= 0 ? "+" : "") + formatCurrency(Math.round(netFlow));
    if (netJpyEl) netJpyEl.textContent = (netFlowJpy >= 0 ? "+" : "") + formatCurrency(Math.round(netFlowJpy));
    
    const netFlowCard = document.querySelector(".card-muamalat-netflow");
    if (netFlowCard) {
        if (netFlow >= 0) {
            netFlowCard.style.setProperty("--color-cc", "#10b981");
            netFlowCard.style.setProperty("--color-cc-glow", "rgba(16, 185, 129, 0.15)");
        } else {
            netFlowCard.style.setProperty("--color-cc", "#ef4444");
            netFlowCard.style.setProperty("--color-cc-glow", "rgba(239, 68, 68, 0.15)");
        }
    }
    
    // Draw/update Muamalat Charts
    updateMuamalatCharts(monthTxs, filteredTxs);
    
    // Render rows
    tbody.innerHTML = "";
    if (filteredTxs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-table-msg">No transactions found for this period matching filters.</td></tr>`;
        return;
    }
    
    const reversedTxs = [...filteredTxs].reverse();
    reversedTxs.forEach(tx => {
        const tr = document.createElement("tr");
        
        let badgeColor = "#64748b"; // default slate
        if (tx.sign === "+") {
            badgeColor = "#10b981"; // green
        } else {
            if (tx.type === "Virtual Account") badgeColor = "#8b5cf6"; // purple
            else if (tx.type === "Pembayaran Qris") badgeColor = "#ec4899"; // pink
            else if (tx.type === "Ewallet") badgeColor = "#06b6d4"; // cyan
            else if (tx.type === "Tarik Tunai") badgeColor = "#f59e0b"; // amber
            else if (tx.type === "Transfer") badgeColor = "#3b82f6"; // blue
            else badgeColor = "#ef4444"; // red
        }
        
        const typeBadge = `<span style="background: ${badgeColor}20; color: ${badgeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${escapeHtml(tx.type || 'Other')}</span>`;
        
        const parts = tx.date.split("-");
        const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">${formattedDate}</td>
            <td>${typeBadge}</td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(tx.description)}</div>
            </td>
            <td class="amount-col" style="color: ${tx.sign === '+' ? '#10b981' : 'var(--text-primary)'}; font-weight: 500;">
                ${tx.sign}Rp ${formatCurrency(Math.round(tx.amount))}
            </td>
            <td class="amount-col" style="color: var(--text-muted); font-size: 0.85rem;">
                ~ ¥${formatCurrency(Math.round(tx.amount_jpy))}
            </td>
            <td class="amount-col" style="font-family: monospace; font-weight: 500;">
                Rp ${formatCurrency(Math.round(tx.balance))}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateMuamalatCharts(monthTxs, filteredTxs) {
    // --- Chart 1: Monthly Inflow vs Outflow (Trend) ---
    const trendCtx = document.getElementById("muamalat-trend-chart");
    if (trendCtx) {
        // Aggregate inflow/outflow per month from the entire dataset
        const monthlyData = {};
        muamalatData.forEach(tx => {
            const key = `${tx.month} ${tx.year}`;
            if (!monthlyData[key]) {
                monthlyData[key] = { inflow: 0, outflow: 0 };
            }
            if (tx.sign === "+") {
                monthlyData[key].inflow += tx.amount;
            } else {
                monthlyData[key].outflow += tx.amount;
            }
        });
        
        // Sort periods chronologically
        const monthIndices = {
            "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
            "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
        };
        const sortedPeriods = Object.keys(monthlyData).sort((a, b) => {
            const [m1, y1] = a.split(" ");
            const [m2, y2] = b.split(" ");
            if (y1 !== y2) return parseInt(y1) - parseInt(y2);
            return monthIndices[m1] - monthIndices[m2];
        });
        
        const labels = sortedPeriods;
        const inflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].inflow / 1000)); // in thousands
        const outflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].outflow / 1000));
        
        if (muamalatTrendChart) {
            muamalatTrendChart.destroy();
        }
        
        const isDark = document.body.classList.contains("dark-theme");
        const textCol = isDark ? "#94a3b8" : "#475569";
        const gridCol = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.05)";
        
        muamalatTrendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Inflows (Deposits)',
                        data: inflowValues,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: 'Outflows (Spendings)',
                        data: outflowValues,
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        borderColor: '#ef4444',
                        borderWidth: 1.5,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textCol, font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': Rp ' + formatCurrency(context.raw * 1000);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textCol, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: gridCol },
                        ticks: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) {
                                return 'Rp ' + formatCurrency(value) + 'k';
                            }
                        }
                    }
                }
            }
        });
    }

    // --- Chart 2: Outflow Breakdown by Transaction Type ---
    const typeCtx = document.getElementById("muamalat-type-chart");
    if (typeCtx) {
        const typeAgg = {};
        
        // We only aggregate outflows (sign === "-")
        monthTxs.forEach(tx => {
            if (tx.sign === "-") {
                const t = tx.type || "Other";
                typeAgg[t] = (typeAgg[t] || 0) + tx.amount;
            }
        });
        
        const labels = Object.keys(typeAgg);
        const values = Object.values(typeAgg).map(val => Math.round(val));
        
        const typeColors = {
            "Transfer": "#3b82f6",         // Blue
            "Tarik Tunai": "#f59e0b",       // Amber
            "Pembayaran Qris": "#ec4899",   // Pink
            "Ewallet": "#06b6d4",           // Cyan
            "Virtual Account": "#8b5cf6",   // Purple
            "Biaya": "#64748b",             // Slate
            "Other": "#94a3b8"
        };
        
        const colors = labels.map(l => typeColors[l] || "#64748b");
        
        if (muamalatTypeChart) {
            muamalatTypeChart.destroy();
        }
        
        if (labels.length === 0) {
            const isDark = document.body.classList.contains("dark-theme");
            muamalatTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: ['No Outflows'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        } else {
            const isDark = document.body.classList.contains("dark-theme");
            const textCol = isDark ? "#94a3b8" : "#475569";
            
            muamalatTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            data: values,
                            backgroundColor: colors,
                            borderWidth: isDark ? 2 : 1,
                            borderColor: isDark ? '#121621' : '#ffffff'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: textCol,
                                font: { family: 'Inter', size: 10 },
                                boxWidth: 12,
                                padding: 10
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ' ' + context.label + ': Rp ' + formatCurrency(context.raw);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
}

// --- GoPay Account Tracker Logic ---
function initGoPayAccountTracker() {
    const gopaySelect = document.getElementById("gopay-statement-select");
    if (!gopaySelect) return;
    
    const periods = new Set();
    gopayData.forEach(tx => {
        if (tx.month && tx.year) {
            periods.add(`${tx.month} ${tx.year}`);
        }
    });
    
    const monthIndices = {
        "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
        "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
    };
    const sortedPeriods = Array.from(periods).sort((a, b) => {
        const [m1, y1] = a.split(" ");
        const [m2, y2] = b.split(" ");
        if (y1 !== y2) return parseInt(y2) - parseInt(y1);
        return monthIndices[m2] - monthIndices[m1];
    });
    
    gopaySelect.innerHTML = "";
    sortedPeriods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        gopaySelect.appendChild(opt);
    });
    
    gopaySelect.addEventListener("change", () => {
        updateGoPayAccountView();
    });
    
    const gopayType = document.getElementById("gopay-type-select");
    if (gopayType) {
        gopayType.addEventListener("change", () => {
            updateGoPayAccountView();
        });
    }
    
    const gopaySearch = document.getElementById("gopay-search-input");
    if (gopaySearch) {
        gopaySearch.addEventListener("input", () => {
            updateGoPayAccountView();
        });
    }
    
    updateGoPayAccountView();
}

function updateGoPayAccountView() {
    const gopaySelect = document.getElementById("gopay-statement-select");
    const tbody = document.getElementById("gopay-table-body");
    const countEl = document.getElementById("gopay-transaction-count");
    const gopayTypeSelect = document.getElementById("gopay-type-select");
    const gopaySearchInput = document.getElementById("gopay-search-input");
    
    if (!gopaySelect || !tbody) return;
    
    const selectedPeriod = gopaySelect.value;
    if (!selectedPeriod) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-table-msg">No statement data available.</td></tr>`;
        return;
    }
    
    gopayData.sort((a,b) => new Date(a.date + 'T' + (a.time || '00:00')) - new Date(b.date + 'T' + (b.time || '00:00')));
    
    const monthTxs = gopayData.filter(tx => `${tx.month} ${tx.year}` === selectedPeriod);
    
    let filteredTxs = [...monthTxs];
    
    if (gopayTypeSelect && gopayTypeSelect.value !== "all") {
        filteredTxs = filteredTxs.filter(tx => tx.type === gopayTypeSelect.value);
    }
    
    if (gopaySearchInput && gopaySearchInput.value.trim() !== "") {
        const query = gopaySearchInput.value.toLowerCase().trim();
        filteredTxs = filteredTxs.filter(tx => 
            tx.description.toLowerCase().includes(query) || 
            tx.payment_method.toLowerCase().includes(query)
        );
    }
    
    if (countEl) {
        countEl.textContent = `${filteredTxs.length} transaction${filteredTxs.length !== 1 ? 's' : ''}`;
    }
    
    let totalInflow = 0;
    let totalOutflow = 0;
    monthTxs.forEach(tx => {
        if (tx.sign === "+") {
            totalInflow += tx.amount;
        } else {
            totalOutflow += tx.amount;
        }
    });
    
    const endingBalance = monthTxs.length > 0 ? monthTxs[monthTxs.length - 1].balance : 0;
    
    let runningCoins = 0;
    let endingCoins = 0;
    const lastTxInPeriod = monthTxs.length > 0 ? monthTxs[monthTxs.length - 1] : null;
    if (lastTxInPeriod) {
        for (let tx of gopayData) {
            const txDateStr = tx.date + 'T' + (tx.time || '00:00');
            const limitDateStr = lastTxInPeriod.date + 'T' + (lastTxInPeriod.time || '00:00');
            if (txDateStr <= limitDateStr) {
                if (tx.sign === "+") {
                    runningCoins += tx.coins;
                } else {
                    runningCoins -= tx.coins;
                }
            } else {
                break;
            }
        }
        endingCoins = runningCoins;
    }
    
    const rate = getExchangeRate();
    const endingBalanceJpy = endingBalance / rate;
    const endingCoinsJpy = endingCoins / rate;
    const totalInflowJpy = totalInflow / rate;
    const totalOutflowJpy = totalOutflow / rate;
    
    const balIdrEl = document.getElementById("kpi-gopay-balance-idr");
    const balJpyEl = document.getElementById("kpi-gopay-balance-jpy");
    const coinsIdrEl = document.getElementById("kpi-gopay-coins-idr");
    const coinsJpyEl = document.getElementById("kpi-gopay-coins-jpy");
    const infIdrEl = document.getElementById("kpi-gopay-inflow-idr");
    const infJpyEl = document.getElementById("kpi-gopay-inflow-jpy");
    const outIdrEl = document.getElementById("kpi-gopay-outflow-idr");
    const outJpyEl = document.getElementById("kpi-gopay-outflow-jpy");
    
    if (balIdrEl) balIdrEl.textContent = formatCurrency(Math.round(endingBalance));
    if (balJpyEl) balJpyEl.textContent = formatCurrency(Math.round(endingBalanceJpy));
    if (coinsIdrEl) coinsIdrEl.textContent = formatCurrency(Math.round(endingCoins));
    if (coinsJpyEl) coinsJpyEl.textContent = formatCurrency(Math.round(endingCoinsJpy));
    if (infIdrEl) infIdrEl.textContent = formatCurrency(Math.round(totalInflow));
    if (infJpyEl) infJpyEl.textContent = formatCurrency(Math.round(totalInflowJpy));
    if (outIdrEl) outIdrEl.textContent = formatCurrency(Math.round(totalOutflow));
    if (outJpyEl) outJpyEl.textContent = formatCurrency(Math.round(totalOutflowJpy));
    
    updateGoPayCharts(monthTxs, filteredTxs);
    
    tbody.innerHTML = "";
    if (filteredTxs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-table-msg">No transactions found for this period matching filters.</td></tr>`;
        return;
    }
    
    const reversedTxs = [...filteredTxs].reverse();
    reversedTxs.forEach(tx => {
        const tr = document.createElement("tr");
        
        let badgeColor = "#64748b";
        if (tx.sign === "+") {
            badgeColor = "#10b981";
        } else {
            if (tx.type === "Pembayaran") badgeColor = "#ef4444";
            else if (tx.type === "Transfer") badgeColor = "#3b82f6";
            else if (tx.type === "Top Up") badgeColor = "#10b981";
            else if (tx.type === "Cashback") badgeColor = "#f59e0b";
            else if (tx.type === "Bunga") badgeColor = "#06b6d4";
            else if (tx.type === "Biaya") badgeColor = "#64748b";
            else badgeColor = "#ec4899";
        }
        
        const typeBadge = `<span style="background: ${badgeColor}20; color: ${badgeColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${escapeHtml(tx.type || 'Other')}</span>`;
        
        const parts = tx.date.split("-");
        const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        
        const cashDisplay = tx.amount > 0 ? `${tx.sign}Rp ${formatCurrency(Math.round(tx.amount))}` : "-";
        const coinsDisplay = tx.coins > 0 ? `${tx.sign}${formatCurrency(Math.round(tx.coins))} Pts` : "-";
        const jpyDisplay = tx.amount > 0 ? `~ ¥${formatCurrency(Math.round(tx.amount_jpy))}` : (tx.coins > 0 ? `~ ¥${formatCurrency(Math.round(tx.coins_jpy))}` : "-");
        
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace;">${formattedDate} ${tx.time || ''}</td>
            <td>${typeBadge}</td>
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(tx.description)}</div>
            </td>
            <td style="font-size: 0.9rem; color: var(--text-secondary);">${escapeHtml(tx.payment_method)}</td>
            <td class="amount-col" style="color: ${tx.sign === '+' && tx.amount > 0 ? '#10b981' : 'var(--text-primary)'}; font-weight: 500;">
                ${cashDisplay}
            </td>
            <td class="amount-col" style="color: ${tx.sign === '+' ? '#10b981' : '#f59e0b'}; font-weight: 500;">
                ${coinsDisplay}
            </td>
            <td class="amount-col" style="color: var(--text-muted); font-size: 0.85rem;">
                ${jpyDisplay}
            </td>
            <td class="amount-col" style="font-family: monospace; font-weight: 500;">
                Rp ${formatCurrency(Math.round(tx.balance))}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateGoPayCharts(monthTxs, filteredTxs) {
    const trendCtx = document.getElementById("gopay-trend-chart");
    if (trendCtx) {
        const monthlyData = {};
        gopayData.forEach(tx => {
            const key = `${tx.month} ${tx.year}`;
            if (!monthlyData[key]) {
                monthlyData[key] = { inflow: 0, outflow: 0 };
            }
            if (tx.sign === "+") {
                monthlyData[key].inflow += tx.amount;
            } else {
                monthlyData[key].outflow += tx.amount;
            }
        });
        
        const monthIndices = {
            "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
            "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
        };
        const sortedPeriods = Object.keys(monthlyData).sort((a, b) => {
            const [m1, y1] = a.split(" ");
            const [m2, y2] = b.split(" ");
            if (y1 !== y2) return parseInt(y1) - parseInt(y2);
            return monthIndices[m1] - monthIndices[m2];
        });
        
        const labels = sortedPeriods;
        const inflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].inflow / 1000));
        const outflowValues = sortedPeriods.map(p => Math.round(monthlyData[p].outflow / 1000));
        
        if (gopayTrendChart) {
            gopayTrendChart.destroy();
        }
        
        const isDark = document.body.classList.contains("dark-theme");
        const textCol = isDark ? "#94a3b8" : "#475569";
        const gridCol = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.05)";
        
        gopayTrendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Inflows (Deposits)',
                        data: inflowValues,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: 'Outflows (Spendings)',
                        data: outflowValues,
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        borderColor: '#ef4444',
                        borderWidth: 1.5,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: textCol, font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': Rp ' + formatCurrency(context.raw * 1000);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textCol, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: gridCol },
                        ticks: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) {
                                return 'Rp ' + formatCurrency(value) + 'k';
                            }
                        }
                    }
                }
            }
        });
    }

    const typeCtx = document.getElementById("gopay-type-chart");
    if (typeCtx) {
        const typeAgg = {};
        
        monthTxs.forEach(tx => {
            if (tx.sign === "-") {
                const t = tx.type || "Other";
                typeAgg[t] = (typeAgg[t] || 0) + tx.amount + tx.coins;
            }
        });
        
        const labels = Object.keys(typeAgg);
        const values = Object.values(typeAgg).map(val => Math.round(val));
        
        const typeColors = {
            "Pembayaran": "#ef4444",
            "Transfer": "#3b82f6",
            "Top Up": "#10b981",
            "Cashback": "#f59e0b",
            "Bunga": "#06b6d4",
            "Biaya": "#64748b",
            "Other": "#94a3b8"
        };
        
        const colors = labels.map(l => typeColors[l] || "#64748b");
        
        if (gopayTypeChart) {
            gopayTypeChart.destroy();
        }
        
        if (labels.length === 0) {
            const isDark = document.body.classList.contains("dark-theme");
            gopayTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: ['No Outflows'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        } else {
            const isDark = document.body.classList.contains("dark-theme");
            const textCol = isDark ? "#94a3b8" : "#475569";
            
            gopayTypeChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            data: values,
                            backgroundColor: colors,
                            borderWidth: isDark ? 2 : 1,
                            borderColor: isDark ? '#121621' : '#ffffff'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: textCol,
                                font: { family: 'Inter', size: 10 },
                                boxWidth: 12,
                                padding: 10
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ' ' + context.label + ': Rp ' + formatCurrency(context.raw);
                                }
                            }
                        }
                    }
                }            });
        }
    }
}

// --- SPayLater Tracker Logic ---
// --- SPayLater Tracker Logic ---
function initSPayLaterTracker() {
    const spSelect = document.getElementById("spaylater-statement-select");
    if (!spSelect) return;

    // Filter cashless transactions with Note matching 'SPayLater (Stmt:'
    const spTrans = cashData.filter(item => {
        if (item.payment_type !== 'cashless') return false;
        return (item.note || '').includes('SPayLater (Stmt:');
    });

    const monthsOrder = {
        "Januari": 1, "Februari": 2, "Maret": 3, "April": 4, "Mei": 5, "Juni": 6,
        "Juli": 7, "Agustus": 8, "September": 9, "Oktober": 10, "November": 11, "Desember": 12
    };

    // Extract unique historical statement months
    const stmtSet = new Set();
    spTrans.forEach(item => {
        const match = item.note.match(/SPayLater \(Stmt:\s*([A-Za-z]+ \d{4})\)/);
        if (match) {
            stmtSet.add(match[1]);
        }
    });

    const stmtListHist = Array.from(stmtSet).sort((a, b) => {
        const [mA, yA] = a.split(" ");
        const [mB, yB] = b.split(" ");
        if (yA !== yB) return parseInt(yA) - parseInt(yB);
        return monthsOrder[mA] - monthsOrder[mB];
    });

    const maxStmtMonthStr = stmtListHist[stmtListHist.length - 1]; // e.g., "Mei 2026"

    // Group actual historical transactions into spaylaterGrouped
    spaylaterGrouped = {};
    spTrans.forEach(item => {
        const match = item.note.match(/SPayLater \(Stmt:\s*([A-Za-z]+ \d{4})\)/);
        if (match) {
            const stmtMonth = match[1];
            if (!spaylaterGrouped[stmtMonth]) {
                spaylaterGrouped[stmtMonth] = {
                    totalIdr: 0,
                    totalJpy: 0,
                    transactions: []
                };
            }
            spaylaterGrouped[stmtMonth].transactions.push(item);
            
            let amountIdr = 0;
            const amountMatch = item.note.match(/\(Rp\s*([\d\.,]+)\)/);
            if (amountMatch) {
                amountIdr = parseFloat(amountMatch[1].replace(/[,.]/g, ""));
            }
            spaylaterGrouped[stmtMonth].totalIdr += amountIdr;
            spaylaterGrouped[stmtMonth].totalJpy += item.pengeluaran;
        }
    });

    // Identify active installment plans to project future payments
    const instPattern = /(.*?)\s*\((\d+)\/(\d+)\)/;
    const installmentsMap = {};

    spTrans.forEach(item => {
        const match = item.item.match(instPattern);
        if (match) {
            const rawName = match[1].trim();
            const currInst = parseInt(match[2]);
            const totalInst = parseInt(match[3]);

            const stmtMatch = item.note.match(/SPayLater \(Stmt:\s*([A-Za-z]+ \d{4})\)/);
            if (!stmtMatch) return;
            const stmtMonth = stmtMatch[1];

            // Normalize spelling: e.g. 7omai -> 70mai
            let cleanName = rawName.replace(/\s+/g, ' ');
            if (cleanName.toLowerCase().startsWith("7omai")) {
                cleanName = cleanName.replace(/7omai/i, "70mai");
            }
            // Capitalize words
            cleanName = cleanName.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            const key = `${cleanName}_${totalInst}`;

            let amountIdr = 0;
            const amountMatch = item.note.match(/\(Rp\s*([\d\.,]+)\)/);
            if (amountMatch) {
                amountIdr = parseFloat(amountMatch[1].replace(/[,.]/g, ""));
            }

            if (!installmentsMap[key]) {
                installmentsMap[key] = {
                    name: cleanName,
                    totalInst: totalInst,
                    monthlyIdr: amountIdr,
                    monthlyJpy: item.pengeluaran,
                    category: item.kategori_normalized,
                    payments: []
                };
            }
            if (amountIdr > installmentsMap[key].monthlyIdr) {
                installmentsMap[key].monthlyIdr = amountIdr;
                installmentsMap[key].monthlyJpy = item.pengeluaran;
            }

            installmentsMap[key].payments.push({
                currInst: currInst,
                date: item.tanggal,
                stmtMonth: stmtMonth
            });
        }
    });

    // Project future statement months based on active installments
    Object.values(installmentsMap).forEach(plan => {
        plan.payments.sort((a, b) => b.currInst - a.currInst);
        const latestPayment = plan.payments[0];

        let monthsPaid = latestPayment.currInst;
        let monthsLeft = plan.totalInst - monthsPaid;
        let isCompleted = (monthsLeft === 0);

        // Auto-complete logic
        const endStmtMonth = shiftStatementMonth(latestPayment.stmtMonth, monthsLeft);
        if (!isCompleted && endStmtMonth && maxStmtMonthStr && isStatementBeforeOrEqual(endStmtMonth, maxStmtMonthStr)) {
            isCompleted = true;
            monthsPaid = plan.totalInst;
            monthsLeft = 0;
        }

        if (!isCompleted) {
            for (let i = monthsPaid + 1; i <= plan.totalInst; i++) {
                const monthsForward = i - monthsPaid;
                const futureStmtMonth = shiftStatementMonth(latestPayment.stmtMonth, monthsForward);

                if (!spaylaterGrouped[futureStmtMonth]) {
                    spaylaterGrouped[futureStmtMonth] = {
                        totalIdr: 0,
                        totalJpy: 0,
                        transactions: []
                    };
                }

                const projTx = {
                    id: `Proj-SP-${plan.name.replace(/[^a-zA-Z0-9]/g, '')}-${i}`,
                    tanggal: shiftDateByMonths(latestPayment.date, monthsForward),
                    item: `${plan.name} (${i}/${plan.totalInst})`,
                    kategori_normalized: plan.category || "Others",
                    payment_type: "cashless",
                    pengeluaran: plan.monthlyJpy || (plan.monthlyIdr / getExchangeRate()),
                    note: `SPayLater (Stmt: ${futureStmtMonth}) (Rp ${new Intl.NumberFormat('id-ID').format(Math.round(plan.monthlyIdr))})`,
                    isProjected: true
                };

                spaylaterGrouped[futureStmtMonth].transactions.push(projTx);
                spaylaterGrouped[futureStmtMonth].totalIdr += plan.monthlyIdr;
                spaylaterGrouped[futureStmtMonth].totalJpy += plan.monthlyJpy || (plan.monthlyIdr / getExchangeRate());
            }
        }
    });

    // Get sorted list of statement periods (historical + projected)
    const sortedPeriods = Object.keys(spaylaterGrouped).sort((a, b) => {
        const [mA, yA] = a.split(" ");
        const [mB, yB] = b.split(" ");
        if (yA !== yB) return parseInt(yB) - parseInt(yA);
        return monthsOrder[mB] - monthsOrder[mA];
    });

    spSelect.innerHTML = "";
    sortedPeriods.forEach(stmt => {
        const opt = document.createElement("option");
        opt.value = stmt;

        const isFuture = !isStatementBeforeOrEqual(stmt, maxStmtMonthStr);
        const statusLabel = isFuture ? " (Next Bill)" : "";
        opt.textContent = `${stmt}${statusLabel} — Rp ${new Intl.NumberFormat('id-ID').format(Math.round(spaylaterGrouped[stmt].totalIdr))}`;
        spSelect.appendChild(opt);
    });

    // Set default value to maxStmtMonthStr
    if (maxStmtMonthStr && spSelect.querySelector(`option[value="${maxStmtMonthStr}"]`)) {
        spSelect.value = maxStmtMonthStr;
    } else if (sortedPeriods.length > 0) {
        spSelect.value = sortedPeriods[0];
    }

    // Event listeners
    spSelect.addEventListener("change", () => {
        updateSPayLaterView();
    });

    const spType = document.getElementById("spaylater-type-select");
    if (spType) {
        spType.addEventListener("change", () => {
            updateSPayLaterView();
        });
    }

    const spSearch = document.getElementById("spaylater-search-input");
    if (spSearch) {
        spSearch.addEventListener("input", () => {
            updateSPayLaterView();
        });
    }

    updateSPayLaterView();
}

function updateSPayLaterView() {
    const spSelect = document.getElementById("spaylater-statement-select");
    const tbody = document.getElementById("spaylater-table-body");
    const countEl = document.getElementById("spaylater-transaction-count");
    const spTypeSelect = document.getElementById("spaylater-type-select");
    const spSearchInput = document.getElementById("spaylater-search-input");

    if (!spSelect || !tbody) return;

    const selectedPeriod = spSelect.value;
    if (!selectedPeriod) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No data available</td></tr>`;
        return;
    }

    // Retrieve cashless transactions from spaylaterGrouped
    const allSpTrans = spaylaterGrouped[selectedPeriod] ? spaylaterGrouped[selectedPeriod].transactions : [];

    // Sort chronologically by date, then ID
    allSpTrans.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || (parseInt(String(a.id).replace(/\D/g, '')) || 0) - (parseInt(String(b.id).replace(/\D/g, '')) || 0));

    // Apply filters
    let filtered = [...allSpTrans];

    // Filter by type (Bayar Nanti vs Cicilan)
    if (spTypeSelect && spTypeSelect.value !== "all") {
        const typeFilter = spTypeSelect.value; // 'Bayar Nanti' or 'Cicilan'
        filtered = filtered.filter(item => {
            if (typeFilter === "Cicilan") {
                return /\(\d+\/\d+\)/.test(item.item);
            } else {
                return item.item.includes("(Pay Later)") || !/\(\d+\/\d+\)/.test(item.item);
            }
        });
    }

    // Filter by text search
    if (spSearchInput && spSearchInput.value.trim() !== "") {
        const query = spSearchInput.value.toLowerCase().trim();
        filtered = filtered.filter(item => 
            item.item.toLowerCase().includes(query) || 
            (item.kategori_normalized || '').toLowerCase().includes(query)
        );
    }

    // Render Table Rows
    tbody.innerHTML = "";
    filtered.forEach(row => {
        const tr = document.createElement("tr");
        if (row.isProjected) {
            tr.style.opacity = "0.75";
            tr.style.fontStyle = "italic";
        }

        let displayItem = row.item;
        let typeStr = "Bayar Nanti";
        let termStr = "Pay Later";

        const instMatch = row.item.match(/(.*?)\s*\((\d+)\/(\d+)\)/);
        const plMatch = row.item.match(/(.*?)\s*\(Pay Later\)/);

        if (instMatch) {
            displayItem = instMatch[1];
            typeStr = "Cicilan";
            termStr = `${instMatch[2]}/${instMatch[3]}`;
        } else if (plMatch) {
            displayItem = plMatch[1];
            typeStr = "Bayar Nanti";
            termStr = "Pay Later";
        }

        // Get IDR amount from note
        let amountIdr = 0;
        const amountMatch = row.note.match(/\(Rp\s*([\d\.,]+)\)/);
        if (amountMatch) {
            amountIdr = parseFloat(amountMatch[1].replace(/[,.]/g, ""));
        }

        const dateFormatted = row.tanggal;
        const categoryLabel = row.kategori_normalized || "Others";

        tr.innerHTML = `
            <td>${dateFormatted}</td>
            <td><span class="badge ${typeStr === 'Cicilan' ? 'badge-cycle' : 'badge-normal'}" style="background: ${typeStr === 'Cicilan' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)'}; color: ${typeStr === 'Cicilan' ? '#f59e0b' : '#3b82f6'}; border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; font-weight: 500;">${typeStr}</span></td>
            <td style="font-weight: 500; color: var(--text-primary);">${displayItem}</td>
            <td style="color: var(--text-secondary); font-family: monospace;">${termStr}</td>
            <td><span class="category-pill pill-${categoryLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')}">${categoryLabel}</span></td>
            <td class="amount-col" style="font-weight: 700; color: var(--color-expense);">Rp ${new Intl.NumberFormat('id-ID').format(Math.round(amountIdr))}</td>
            <td class="amount-col" style="font-weight: 600; color: var(--text-secondary);">¥ ${formatCurrency(row.pengeluaran)}</td>
        `;
        tbody.appendChild(tr);
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`;
    }

    // Calculate & Update KPIs
    // 1. Current Monthly Bill
    let billIdr = 0;
    allSpTrans.forEach(row => {
        const amountMatch = row.note.match(/\(Rp\s*([\d\.,]+)\)/);
        if (amountMatch) {
            billIdr += parseFloat(amountMatch[1].replace(/[,.]/g, ""));
        }
    });
    const billJpy = billIdr / getExchangeRate();

    document.getElementById("kpi-spaylater-bill-idr").textContent = new Intl.NumberFormat('id-ID').format(Math.round(billIdr));
    document.getElementById("kpi-spaylater-bill-jpy").textContent = formatCurrency(billJpy);

    // 2. Active Installments and Outstanding Debt calculated and updated by tracker
    updateSPayLaterInstallmentsTracker(selectedPeriod);

    // 3. Statement Purchases
    let monthlySpendingIdr = 0;
    allSpTrans.forEach(row => {
        const instMatch = row.item.match(/\((\d+)\/(\d+)\)/);
        const amountMatch = row.note.match(/\(Rp\s*([\d\.,]+)\)/);
        if (amountMatch) {
            const amt = parseFloat(amountMatch[1].replace(/[,.]/g, ""));
            if (instMatch) {
                if (parseInt(instMatch[1]) === 1) {
                    monthlySpendingIdr += parseInt(instMatch[2]) * amt;
                }
            } else {
                monthlySpendingIdr += amt;
            }
        }
    });
    const monthlySpendingJpy = monthlySpendingIdr / getExchangeRate();

    document.getElementById("kpi-spaylater-purchases-idr").textContent = new Intl.NumberFormat('id-ID').format(Math.round(monthlySpendingIdr));
    document.getElementById("kpi-spaylater-purchases-jpy").textContent = formatCurrency(monthlySpendingJpy);

    // Update charts
    updateSPayLaterCharts(selectedPeriod);
}

function isStatementBeforeOrEqual(stmtA, stmtB) {
    if (!stmtA || !stmtB) return false;
    const monthsOrder = {
        "Januari": 1, "Februari": 2, "Maret": 3, "April": 4, "Mei": 5, "Juni": 6,
        "Juli": 7, "Agustus": 8, "September": 9, "Oktober": 10, "November": 11, "Desember": 12
    };
    const [mA, yA] = stmtA.split(" ");
    const [mB, yB] = stmtB.split(" ");
    const yearA = parseInt(yA);
    const yearB = parseInt(yB);
    if (yearA !== yearB) {
        return yearA < yearB;
    }
    return monthsOrder[mA] <= monthsOrder[mB];
}

function shiftStatementMonth(stmtStr, monthsDiff) {
    const idMonths = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const parts = stmtStr.split(" ");
    const monthName = parts[0];
    const year = parseInt(parts[1]);
    const monthIdx = idMonths.indexOf(monthName);
    if (monthIdx === -1) return stmtStr;
    
    let targetMonthIdx = monthIdx + monthsDiff;
    let targetYear = year;
    
    if (targetMonthIdx < 0) {
        const yearsToSubtract = Math.ceil(Math.abs(targetMonthIdx) / 12);
        targetMonthIdx += yearsToSubtract * 12;
        targetYear -= yearsToSubtract;
    }
    targetYear += Math.floor(targetMonthIdx / 12);
    targetMonthIdx = targetMonthIdx % 12;
    
    return `${idMonths[targetMonthIdx]} ${targetYear}`;
}

function shiftDateByMonths(dateStr, months) {
    const date = new Date(dateStr);
    date.setMonth(date.getMonth() + months);
    return date.toISOString().split('T')[0];
}

function updateSPayLaterInstallmentsTracker(selectedPeriod) {
    const tableBody = document.getElementById("spaylater-installments-table-body");
    const countEl = document.getElementById("spaylater-installments-count");
    
    const kpiCountEl = document.getElementById("kpi-spaylater-installments");
    const kpiDebtIdrEl = document.getElementById("kpi-spaylater-debt-idr");
    const kpiDebtJpyEl = document.getElementById("kpi-spaylater-debt-jpy");

    if (!tableBody) return;

    tableBody.innerHTML = "";

    // 1. Filter all SPayLater transactions from cashData
    const spTrans = cashData.filter(item => {
        if (item.payment_type !== 'cashless') return false;
        return (item.note || '').includes('SPayLater (Stmt:');
    });

    // 2. Identify installment plans: item matches name (X/Y)
    const instPattern = /(.*?)\s*\((\d+)\/(\d+)\)/;
    const installmentsMap = {};

    spTrans.forEach(item => {
        const match = item.item.match(instPattern);
        if (match) {
            const rawName = match[1].trim();
            const currInst = parseInt(match[2]);
            const totalInst = parseInt(match[3]);

            const stmtMatch = item.note.match(/SPayLater \(Stmt:\s*([A-Za-z]+ \d{4})\)/);
            if (!stmtMatch) return;
            const stmtMonth = stmtMatch[1];

            // Normalize spelling: e.g. 7omai -> 70mai
            let cleanName = rawName.replace(/\s+/g, ' ');
            if (cleanName.toLowerCase().startsWith("7omai")) {
                cleanName = cleanName.replace(/7omai/i, "70mai");
            }
            // Capitalize words
            cleanName = cleanName.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            const key = `${cleanName}_${totalInst}`;

            let amountIdr = 0;
            const amountMatch = item.note.match(/\(Rp\s*([\d\.,]+)\)/);
            if (amountMatch) {
                amountIdr = parseFloat(amountMatch[1].replace(/[,.]/g, ""));
            }

            if (!installmentsMap[key]) {
                installmentsMap[key] = {
                    name: cleanName,
                    totalInst: totalInst,
                    monthlyIdr: amountIdr,
                    payments: []
                };
            }
            if (amountIdr > installmentsMap[key].monthlyIdr) {
                installmentsMap[key].monthlyIdr = amountIdr;
            }

            installmentsMap[key].payments.push({
                currInst: currInst,
                stmtMonth: stmtMonth
            });
        }
    });

    // 3. Process each installment plan to find its state as of selectedPeriod
    const plans = [];
    let grandOutstandingIdr = 0;
    let activePlansCount = 0;

    Object.values(installmentsMap).forEach(plan => {
        // Keep payments <= selectedPeriod
        const filteredPayments = plan.payments.filter(p => isStatementBeforeOrEqual(p.stmtMonth, selectedPeriod));
        if (filteredPayments.length === 0) {
            return; // Not started yet as of selectedPeriod
        }

        // Find payment with the maximum currInst in the filtered list
        filteredPayments.sort((a, b) => b.currInst - a.currInst);
        const latestPayment = filteredPayments[0];

        let monthsPaid = latestPayment.currInst;
        let monthsLeft = plan.totalInst - monthsPaid;
        let pctPaid = (monthsPaid / plan.totalInst) * 100;
        let isCompleted = (monthsLeft === 0);

        // Calculate Start Statement Month: subtract (monthsPaid - 1) months from latest payment's statement
        const startStatementLabel = shiftStatementMonth(latestPayment.stmtMonth, -(monthsPaid - 1));

        // Calculate End Statement Month: add monthsLeft (totalInst - monthsPaid) months to latest payment's statement
        const endStatementLabel = shiftStatementMonth(latestPayment.stmtMonth, monthsLeft);

        // Auto-complete logic: if calculated end statement is <= selectedPeriod, the plan is completed!
        if (!isCompleted && isStatementBeforeOrEqual(endStatementLabel, selectedPeriod)) {
            isCompleted = true;
            monthsPaid = plan.totalInst;
            monthsLeft = 0;
            pctPaid = 100;
        }

        const totalPaidIdr = monthsPaid * plan.monthlyIdr;
        const totalLeftIdr = monthsLeft * plan.monthlyIdr;
        const totalPaymentIdr = plan.totalInst * plan.monthlyIdr;

        if (!isCompleted) {
            grandOutstandingIdr += totalLeftIdr;
            activePlansCount++;
        }

        plans.push({
            name: plan.name,
            monthlyIdr: plan.monthlyIdr,
            totalInst: plan.totalInst,
            monthsPaid,
            monthsLeft,
            totalPaidIdr,
            totalLeftIdr,
            totalPaymentIdr,
            pctPaid,
            isCompleted,
            startStatement: startStatementLabel,
            endStatement: endStatementLabel
        });
    });

    // Sort: active plans first (by remaining debt descending), then completed plans (by paid amount descending)
    plans.sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) {
            return a.isCompleted ? 1 : -1;
        }
        if (!a.isCompleted) {
            return b.totalLeftIdr - a.totalLeftIdr;
        }
        return b.totalPaidIdr - a.totalPaidIdr;
    });

    // 4. Update KPI elements
    if (kpiCountEl) kpiCountEl.textContent = activePlansCount;
    if (kpiDebtIdrEl) kpiDebtIdrEl.textContent = new Intl.NumberFormat('id-ID').format(Math.round(grandOutstandingIdr));
    if (kpiDebtJpyEl) kpiDebtJpyEl.textContent = formatCurrency(grandOutstandingIdr / getExchangeRate());

    if (countEl) {
        countEl.textContent = `${activePlansCount} active / ${plans.length} total plans`;
    }

    // 5. Render rows
    if (plans.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="empty-table-msg">No installment transactions found.</td></tr>`;
        return;
    }

    plans.forEach((p, idx) => {
        const tr = document.createElement("tr");
        if (p.isCompleted) {
            tr.style.opacity = "0.65";
        }

        const progressColor = p.isCompleted ? "#10b981" : "#f59e0b";
        const progressHtml = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="flex: 1; min-width: 60px; background: rgba(148, 163, 184, 0.15); height: 6px; border-radius: 3px; overflow: hidden;">
                    <div style="background: ${progressColor}; width: ${p.pctPaid}%; height: 100%; border-radius: 3px;"></div>
                </div>
                <span style="font-size: 0.75rem; font-weight: 600; min-width: 30px; text-align: right; color: var(--text-secondary);">${Math.round(p.pctPaid)}%</span>
            </div>
        `;

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-weight: 500;">#${idx + 1}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                    <span style="font-weight: 600; color: var(--text-primary);">${p.name}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${p.totalInst} months plan</span>
                </div>
            </td>
            <td class="amount-col" style="font-weight: 500;">Rp ${new Intl.NumberFormat('id-ID').format(Math.round(p.monthlyIdr))}</td>
            <td class="amount-col" style="font-weight: 500;">Rp ${new Intl.NumberFormat('id-ID').format(Math.round(p.totalPaymentIdr))}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                    <span style="font-weight: 500;">${p.monthsPaid} / ${p.totalInst} billed</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${p.monthsLeft} left</span>
                </div>
            </td>
            <td>${progressHtml}</td>
            <td class="amount-col" style="font-weight: 500;">Rp ${new Intl.NumberFormat('id-ID').format(Math.round(p.totalPaidIdr))}</td>
            <td class="amount-col">
                <span style="font-weight: 600; color: ${p.isCompleted ? 'var(--text-muted)' : 'var(--text-primary)'};">Rp ${new Intl.NumberFormat('id-ID').format(Math.round(p.totalLeftIdr))}</span>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <i class="fa-regular fa-calendar-plus" style="color: #64748b;"></i>
                    <span style="font-weight: 500; color: var(--text-secondary);">${p.startStatement}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    ${p.isCompleted ? '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i>' : '<i class="fa-regular fa-clock" style="color: #f59e0b;"></i>'}
                    <span style="font-weight: 500; color: ${p.isCompleted ? '#10b981' : 'var(--text-primary)'};">${p.endStatement}</span>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}


function updateSPayLaterCharts(selectedPeriod) {
    const trendCtx = document.getElementById("spaylater-trend-chart");
    if (trendCtx) {
        const spTransAll = cashData.filter(item => {
            if (item.payment_type !== 'cashless') return false;
            return (item.note || '').includes('SPayLater (Stmt:');
        });

        const stmtGroup = {};
        spTransAll.forEach(row => {
            const match = row.note.match(/SPayLater \(Stmt:\s*([A-Za-z]+ \d{4})\)/);
            if (match) {
                const stmt = match[1];
                const amtMatch = row.note.match(/\(Rp\s*([\d\.,]+)\)/);
                if (amtMatch) {
                    const amt = parseFloat(amtMatch[1].replace(/[,.]/g, ""));
                    stmtGroup[stmt] = (stmtGroup[stmt] || 0) + amt;
                }
            }
        });

        const monthsOrder = {
            "Januari": 1, "Februari": 2, "Maret": 3, "April": 4, "Mei": 5, "Juni": 6,
            "Juli": 7, "Agustus": 8, "September": 9, "Oktober": 10, "November": 11, "Desember": 12
        };

        const sortedMonths = Object.keys(stmtGroup).sort((a, b) => {
            const [mA, yA] = a.split(" ");
            const [mB, yB] = b.split(" ");
            if (yA !== yB) return parseInt(yA) - parseInt(yB);
            return monthsOrder[mA] - monthsOrder[mB];
        });

        const labels = sortedMonths;
        const values = sortedMonths.map(m => Math.round(stmtGroup[m]));

        if (spaylaterTrendChart) {
            spaylaterTrendChart.destroy();
        }

        const isDark = document.body.classList.contains("dark-theme");
        const gridCol = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
        const textCol = isDark ? "#94a3b8" : "#475569";

        spaylaterTrendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Bill (IDR)',
                    data: values,
                    backgroundColor: 'rgba(239, 68, 68, 0.75)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ' Bill: Rp ' + new Intl.NumberFormat('id-ID').format(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textCol, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: gridCol },
                        ticks: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) {
                                return 'Rp ' + formatCurrency(value / 1000) + 'k';
                            }
                        }
                    }
                }
            }
        });
    }

    const typeCtx = document.getElementById("spaylater-type-chart");
    if (typeCtx) {
        const allSpTrans = cashData.filter(item => {
            if (item.payment_type !== 'cashless') return false;
            return (item.note || '').includes(`SPayLater (Stmt: ${selectedPeriod}`);
        });

        const catAgg = {};
        allSpTrans.forEach(row => {
            const cat = row.kategori_normalized || "Others";
            const amtMatch = row.note.match(/\(Rp\s*([\d\.,]+)\)/);
            if (amtMatch) {
                const amt = parseFloat(amtMatch[1].replace(/[,.]/g, ""));
                catAgg[cat] = (catAgg[cat] || 0) + amt;
            }
        });

        const labels = Object.keys(catAgg);
        const values = Object.values(catAgg).map(val => Math.round(val));

        const catColors = {
            "Food & Dining": "#ef4444",
            "Transportation": "#3b82f6",
            "Internet": "#10b981",
            "Gifts & Souvenirs": "#f59e0b",
            "Stationery": "#06b6d4",
            "Clothing & Apparel": "#8b5cf6",
            "Household Supplies": "#ec4899",
            "Software/Service": "#64748b",
            "Others": "#94a3b8"
        };

        const colors = labels.map(l => catColors[l] || "#64748b");

        if (spaylaterCategoryChart) {
            spaylaterCategoryChart.destroy();
        }

        const isDark = document.body.classList.contains("dark-theme");
        const textCol = isDark ? "#94a3b8" : "#475569";

        if (labels.length === 0) {
            spaylaterCategoryChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: ['No Data'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        } else {
            spaylaterCategoryChart = new Chart(typeCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors,
                        borderWidth: isDark ? 2 : 1,
                        borderColor: isDark ? '#121621' : '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: textCol,
                                font: { family: 'Inter', size: 10 },
                                boxWidth: 12,
                                padding: 10
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ' ' + context.label + ': Rp ' + new Intl.NumberFormat('id-ID').format(context.raw);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
}

// --- Online Shopping Tracker Logic ---
function updateOnlineShoppingPage(filteredData) {
    const tableBody = document.getElementById("ecom-table-body");
    const countEl = document.getElementById("ecom-count");
    const kpiTotalEl = document.getElementById("ecom-kpi-total");
    const kpiCountEl = document.getElementById("ecom-kpi-count");
    const kpiAvgEl = document.getElementById("ecom-kpi-avg");
    const kpiTopPlatformEl = document.getElementById("ecom-kpi-top-platform");

    if (!tableBody) return;

    const ecomStores = ["amazon", "amazon.co.jp", "temu", "shopee", "tokopedia", "aliexpress", "booth"];
    const isEcomStore = (store) => {
        if (!store) return false;
        const s = store.toLowerCase().trim();
        if (s === "tokopedia card") return false;
        return ecomStores.includes(s) || s.includes("amazon") || s.includes("temu") || s.includes("aliexpress") || s.includes("shopee") || s === "tokopedia" || s.includes("booth");
    };

    // Filter matching transactions
    let ecomData = filteredData.filter(item => isEcomStore(item.tempat) && item.pengeluaran > 0);

    // Apply platform filter if selected
    if (activePlatformFilter !== "all") {
        ecomData = ecomData.filter(item => {
            const p = item.tempat || "";
            if (activePlatformFilter === "Amazon") return p.toLowerCase().includes("amazon");
            if (activePlatformFilter === "Temu") return p.toLowerCase().includes("temu");
            return p.toLowerCase().includes(activePlatformFilter.toLowerCase());
        });
    }

    // Calculate KPIs
    let totalPaid = 0;
    let orderCount = ecomData.length;
    const platformTotals = {};

    ecomData.forEach(item => {
        totalPaid += item.pengeluaran;
        let platform = item.tempat || "Other";
        if (platform.toLowerCase().includes("amazon")) platform = "Amazon";
        if (platform.toLowerCase().includes("temu")) platform = "Temu";
        platformTotals[platform] = (platformTotals[platform] || 0) + item.pengeluaran;
    });

    const avgPaid = orderCount > 0 ? (totalPaid / orderCount) : 0;

    let topPlatform = "N/A";
    let maxPlatformSpent = 0;
    Object.keys(platformTotals).forEach(p => {
        if (platformTotals[p] > maxPlatformSpent) {
            maxPlatformSpent = platformTotals[p];
            topPlatform = p;
        }
    });

    if (kpiTotalEl) kpiTotalEl.textContent = formatCurrency(totalPaid);
    if (kpiCountEl) kpiCountEl.textContent = orderCount.toLocaleString();
    if (kpiAvgEl) kpiAvgEl.textContent = formatCurrency(avgPaid);
    if (kpiTopPlatformEl) {
        kpiTopPlatformEl.textContent = topPlatform;
        kpiTopPlatformEl.title = topPlatform; // Tooltip
    }

    // Update Table
    tableBody.innerHTML = "";
    if (countEl) countEl.textContent = `Showing ${orderCount} orders`;

    if (orderCount === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No online shopping orders recorded for this period.</td></tr>`;
    } else {
        // Sort transactions according to sorting state
        const sorted = [...ecomData].sort((a, b) => {
            let valA, valB;
            if (currentSort.column === "tanggal") {
                valA = new Date(a.tanggal);
                valB = new Date(b.tanggal);
            } else if (currentSort.column === "tempat") {
                valA = (a.tempat || "").toLowerCase();
                valB = (b.tempat || "").toLowerCase();
            } else if (currentSort.column === "item") {
                valA = (a.item || "").toLowerCase();
                valB = (b.item || "").toLowerCase();
            } else if (currentSort.column === "kategori") {
                valA = (a.kategori || "").toLowerCase();
                valB = (b.kategori || "").toLowerCase();
            } else if (currentSort.column === "pengeluaran") {
                valA = a.pengeluaran;
                valB = b.pengeluaran;
            } else {
                valA = a.id;
                valB = b.id;
            }

            if (valA < valB) return currentSort.direction === "asc" ? -1 : 1;
            if (valA > valB) return currentSort.direction === "asc" ? 1 : -1;
            return 0;
        });

        sorted.forEach(item => {
            const tr = document.createElement("tr");
            const platformBadge = (() => {
                const p = item.tempat ? item.tempat.trim() : "Other";
                let bg = "rgba(158, 158, 158, 0.1)";
                let fg = "#9e9e9e";
                let border = "rgba(158, 158, 158, 0.2)";

                if (p.toLowerCase().includes("amazon")) {
                    bg = "rgba(245, 158, 11, 0.1)"; fg = "#f59e0b"; border = "rgba(245, 158, 11, 0.2)";
                } else if (p.toLowerCase().includes("temu")) {
                    bg = "rgba(255, 152, 0, 0.1)"; fg = "#ff9800"; border = "rgba(255, 152, 0, 0.2)";
                } else if (p.toLowerCase().includes("shopee")) {
                    bg = "rgba(255, 87, 34, 0.1)"; fg = "#ff5722"; border = "rgba(255, 87, 34, 0.2)";
                } else if (p.toLowerCase().includes("aliexpress")) {
                    bg = "rgba(233, 30, 99, 0.1)"; fg = "#e91e63"; border = "rgba(233, 30, 99, 0.2)";
                } else if (p.toLowerCase().includes("tokopedia")) {
                    bg = "rgba(76, 175, 80, 0.1)"; fg = "#4caf50"; border = "rgba(76, 175, 80, 0.2)";
                } else if (p.toLowerCase().includes("booth")) {
                    bg = "rgba(0, 188, 212, 0.1)"; fg = "#00bcd4"; border = "rgba(0, 188, 212, 0.2)";
                }
                return `<span class="badge" style="background: ${bg}; color: ${fg}; border: 1px solid ${border}; font-weight: 500; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; display: inline-block;">${p}</span>`;
            })();

            tr.innerHTML = `
                <td>#${item.id}</td>
                <td style="white-space: nowrap;">${item.tanggal}</td>
                <td>${platformBadge}</td>
                <td>${escapeHtml(item.item)}</td>
                <td>${getCategoryBadgeHtml(item.kategori)}</td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(item.note || item.payment_type)}</span></td>
                <td class="amount-col font-mono" style="color: var(--color-expense); font-weight: 500;">¥${Math.round(item.pengeluaran).toLocaleString()}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Update Charts
    updateEcomCharts(ecomData);
}

function updateEcomCharts(ecomData) {
    const isDark = document.body.classList.contains("dark-theme");
    const textCol = isDark ? '#a0aec0' : '#4a5568';
    const gridCol = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    // Colors mapping for platforms
    const platformColors = {
        'Amazon': '#f59e0b',
        'Temu': '#ff9800',
        'Shopee': '#ff5722',
        'AliExpress': '#e91e63',
        'Tokopedia': '#4caf50',
        'Booth': '#00bcd4',
        'Other': '#9e9e9e'
    };

    // 1. Platform Share Chart
    const platformTotals = {};
    ecomData.forEach(item => {
        let platform = item.tempat || "Other";
        if (platform.toLowerCase().includes("amazon")) platform = "Amazon";
        if (platform.toLowerCase().includes("temu")) platform = "Temu";
        platformTotals[platform] = (platformTotals[platform] || 0) + item.pengeluaran;
    });

    const platformLabels = Object.keys(platformTotals);
    const platformData = Object.values(platformTotals);
    const bgColors = platformLabels.map(p => platformColors[p] || '#9e9e9e');

    const platformCtx = document.getElementById("ecom-platform-chart");
    if (platformCtx) {
        if (ecomPlatformChart) ecomPlatformChart.destroy();
        ecomPlatformChart = new Chart(platformCtx, {
            type: 'doughnut',
            data: {
                labels: platformLabels,
                datasets: [{
                    data: platformData,
                    backgroundColor: bgColors,
                    borderWidth: isDark ? 2 : 1,
                    borderColor: isDark ? '#121621' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            boxWidth: 10,
                            padding: 8
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ' ' + context.label + ': ¥' + Math.round(context.raw).toLocaleString();
                            }                        }
                    }
                }
            }
        });
    }

    // 2. Spending Trend Chart
    const monthlyTotals = {};
    ecomData.forEach(item => {
        const key = `${item.tahun}-${String(item.bulan)}`;
        monthlyTotals[key] = (monthlyTotals[key] || 0) + item.pengeluaran;
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(monthlyTotals).sort((a, b) => {
        const [yA, mA] = a.split('-');
        const [yB, mB] = b.split('-');
        const monthNum = {
            'January': 1, 'February': 2, 'March': 3, 'April': 4,
            'May': 5, 'June': 6, 'July': 7, 'August': 8,
            'September': 9, 'October': 10, 'November': 11, 'December': 12
        };
        const dateA = new Date(parseInt(yA), monthNum[mA] - 1);
        const dateB = new Date(parseInt(yB), monthNum[mB] - 1);
        return dateA - dateB;
    });

    const trendLabels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        return `${month.substring(0, 3)} ${year}`;
    });
    const trendData = sortedMonths.map(m => monthlyTotals[m]);

    const trendCtx = document.getElementById("ecom-trend-chart");
    if (trendCtx) {
        if (ecomTrendChart) ecomTrendChart.destroy();
        ecomTrendChart = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: trendLabels,
                datasets: [{
                    label: 'Monthly Spent (¥)',
                    data: trendData,
                    backgroundColor: 'rgba(99, 102, 241, 0.45)',
                    borderColor: '#6366f1',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(99, 102, 241, 0.7)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textCol, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: gridCol },
                        ticks: {
                            color: textCol,
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) { return '¥' + value.toLocaleString(); }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ' Spent: ¥' + Math.round(context.raw).toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
}