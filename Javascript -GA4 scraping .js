// Benchmarking 
async function extractBenchmarkingData() {
  const results = {};

  // ========== Helpers ========================================================
  const SCALE_DISPLAY_NAMES = new Set([
    "ARPPU",
    "ARPU",
    "Average Purchases Revenue",
    "Average Purchases Revenue Per Active User",
  ]);

  function getMetricDisplayName(metric) {
    if (typeof metric === 'object' && metric !== null) {
      if (metric.comment) return metric.comment.trim();
      const spaced = metric.name.replace(/([a-z])([A-Z])/g, '$1 $2');
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
    if (typeof metric === 'string') {
      const spaced = metric.replace(/([a-z])([A-Z])/g, '$1 $2');
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
    return String(metric);
  }

  function needsScale(metric) {
    const display = getMetricDisplayName(metric);
    return SCALE_DISPLAY_NAMES.has(display);
  }

  function toNumberSafe(val) {
    if (val == null) return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    if (typeof val === 'string') {
      const s = val.replace(',', '.');
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function roundTo(n, decimals) {
    return Number(n.toFixed(decimals));
  }

  function formatValue(metric, val) {
    const n = toNumberSafe(val);
    if (n == null) return val; // laisse null / 'n/a'
    if (needsScale(metric)) return roundTo(n / 1e6, 2); // monétaire
    return roundTo(n, 3); // autres métriques
  }

  // Génère la liste des dates ISO J->J
  function generateDateRangeISO(startISO, endISO) {
    const dates = [];
    const start = new Date(startISO + 'T00:00:00Z');
    const end = new Date(endISO + 'T00:00:00Z');
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }

  // découpe en paquets
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ========= Paramétrage période & groupes ==================================
  const allDates = generateDateRangeISO("2025-05-01", "2025-11-11"); // ✏️ à mettre à jour
  const BATCH_SIZE = 75; // ajuste si besoin (50–100 recommandé)
  const dateBatches = chunk(allDates, BATCH_SIZE);

  const groupData = [{ id: 1083, label: "Alternative & Natural Medicine" }]; // ✏️ à mettre à jour en cherchant dans la payload > Request > 0 > Groupid
  console.log(`Processing ${allDates.length} dates in ${dateBatches.length} batches.`);

  const baseURL = 'https://analytics.google.com/analytics/app/data/v2/venus';

  for (const group of groupData) {
    console.log(`\n=== Group: ${group.label} (ID: ${group.id}) ===`);
    const groupMetrics = [];

    for (const batchDates of dateBatches) {
      try {
        const batchRequests = batchDates.map(date => ({
          ...getPayloadRequest(group.id),
          dateRanges: [{ startDate: date, endDate: date }]
        }));

        const currentPayload = {
          entity: { propertyId: "352116288", identityBlendingStrategy: 4 }, // ✏️ à mettre à jour en allant chercher dans la payload
          requests: batchRequests,
          reportId: "dashboard_card_00",
          reportTitle: "intelligent-home", 
          guid: "2F63FFF8-3DEF-4026-8979-F37E7C4C1F31", // ✏️ à mettre à jour en allant chercher dans la payload
          reportingRequestMetadata: {
            isDefault: false,
            reportType: 0,
            hasNonDefaultFilter: false,
            comparisonCount: 1,
            isFromFirebase: false
          }
        };

        const url = `${baseURL}?accessmode=read&reportId=dashboard_card_00&dataset=a47514551p352116288&hl=en_GB&gamonitor=gafe&state=app.reports.reports.intelligenthome`; // ✏️ mettre l'ID de propriété dataset dans l'url
        console.log(`Requesting batch with ${batchDates.length} dates… First=${batchDates[0]} Last=${batchDates[batchDates.length-1]}`);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'sec-ch-ua-platform': 'Windows',
            'Referer': 'https://analytics.google.com/analytics/web/',
            'X-GAFE4-XSRF-TOKEN': 'AO6Y7m_PWYqxvo-kJJXGEOUdtw2lglQP3Q:1762960582835', // ✏️ mettre à jour avec le token du header
            'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
            'sec-ch-ua-mobile': '?0',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8'
          },
          body: JSON.stringify(currentPayload)
        });

        if (!response.ok) {
          console.error(`HTTP error (batch ${batchDates[0]}..${batchDates[batchDates.length-1]}): ${response.status}`);
          const errorBody = await response.text();
          console.error(`Error body: ${errorBody}`);
          continue;
        }

        const rawData = await response.text();
        const cleanData = rawData.replace(/^\)\]\}',\s*/, '');
        const data = JSON.parse(cleanData);

        // On lit chaque réponse (= une date)
        (data?.default?.responses || []).forEach((responseBlock, i) => {
          const row = responseBlock?.responseRows?.[0];
          const annotations = row?.benchmarkingAnnotations || [];
          const theDate = batchDates[i]; // date correcte dans ce batch

          annotations.forEach((annotation, index) => {
            const metricDef = currentPayload.requests[i].metrics[index];
            const rawMetricValue = row?.metricCompoundValues?.[index]?.value ?? null;

            const metricValue = formatValue(metricDef, rawMetricValue);
            const p25 = formatValue(metricDef, annotation?.percentile25 ?? null);
            const p50 = formatValue(metricDef, annotation?.percentile50 ?? null);
            const p75 = formatValue(metricDef, annotation?.percentile75 ?? null);

            groupMetrics.push({
              date: theDate,
              metric: metricDef,
              benchmarkData: { percentile25: p25, percentile50: p50, percentile75: p75 },
              metricValue: metricValue
            });
          });
        });
      } catch (error) {
        console.error(`Error on batch ${batchDates[0]}..${batchDates[batchDates.length-1]}:`, error);
      }
    }

    if (groupMetrics.length) {
      results[group.label] = {
        groupId: group.id.toString(),
        groupName: group.label,
        benchmarkMetrics: groupMetrics
      };
    } else {
      console.warn(`No valid data for group ${group.label} (ID: ${group.id})`);
    }
  }

  // ========= Sortie console & CSV ===========================================
  console.log('Extracted data:', results);
  const successCount = Object.keys(results).length;
  console.log(`\n✅ Successfully extracted data for ${successCount} groups`);

  const metricCategoryMap = {
    addToCartsPerActiveUser: "E-commerce",
    checkoutsPerActiveUser: "E-commerce",
    purchasesPerActiveUser: "E-commerce",
    transactionsPerActiveUser: "E-commerce",
    transactionsPerBuyer: "E-commerce",
    eventCountPerUser: "Event",
    eventsPerSession: "Event",
    screenPageViewsPerUser: "Page/screen",
    screenPageViewsPerSession: "Page/screen",
    averageRevenuePerBuyer: "Revenue",
    averageCombinedRevenuePerUser: "Revenue",
    averageTransactionRevenue: "Revenue",
    averageRevenuePerUser: "Revenue",
    averageTotalAdRevenuePerUser: "Revenue",
    averageSessionDuration: "Session",
    bounceRate: "Session",
    engagedSessionsPerUser: "Session",
    engagementRate: "Session",
    session_conversion_rate: "Session",
    sessionsPerUser: "Session",
    userEngagementDurationPerUser: "User",
    userEngagementDurationPerSession: "User",
    dauMau: "User",
    dauWau: "User",
    firstTimeBuyerConversion: "User",
    firstTimeBuyersPerNewUser: "User",
    newUserRate: "User",
    pmauDau: "User",
    buyerConversion: "User",
    user_conversion_rate: "User",
    wauMau: "User",
    pwauDau: "User"
  };

  const tableData = Object.values(results).flatMap(group =>
    group.benchmarkMetrics.map(entry => ({
      groupName: group.groupName,
      date: entry.date,
      metricName: getMetricDisplayName(entry.metric),
      metricCategory: metricCategoryMap[entry.metric.name ?? entry.metric] ?? 'n/a',
      percentile25: entry.benchmarkData?.percentile25 ?? 'n/a',
      percentile50: entry.benchmarkData?.percentile50 ?? 'n/a',
      percentile75: entry.benchmarkData?.percentile75 ?? 'n/a',
      metricValue: entry.metricValue ?? 'n/a',
    }))
  );

  console.log("\n📊 Benchmarking Percentiles Table :");
  console.table(tableData);

  // CSV
  const displayHeaders = ['Date', 'Benchmark Industry', 'Metric Category', 'Metric Name', 'Percentile25', 'Percentile50', 'Percentile75', 'Your Own Performance'];
  const csvHeaders = ['date', 'groupName', 'metricCategory', 'metricName', 'percentile25', 'percentile50', 'percentile75', 'metricValue'];

  const csvRows = [displayHeaders.join(',')];
  for (const row of tableData) {
    const values = csvHeaders.map(key => {
      const value = row[key];
      if (typeof value === 'number') return value.toString();
      return (typeof value === 'string' && value.includes(',')) ? `"${value}"` : value;
    });
    csvRows.push(values.join(','));
  }

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.setAttribute('download', 'benchmarking_data_2025-01_to_2025-08.csv');
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);

  return results;

  // ========== Structure des requêtes ========================================
  function getPayloadRequest(groupId) {
    return {
      dimensions: [{ name: "nth_day", isSecondary: false }],
      dimensionFilters: [],
      metrics: [
        { name: "pwauDau", isInvisible: false, isSecondary: false, expression: "paid_active_users_7/active_users_1", benchmarkingRequested: true, comment: "Pwau/Dau" },
        { name: "purchasesPerActiveUser", isInvisible: false, isSecondary: false, expression: "purchases/active_users", benchmarkingRequested: true },
        { name: "checkoutsPerActiveUser", isInvisible: false, isSecondary: false, expression: "checkouts/active_users", benchmarkingRequested: true },
        { name: "addToCartsPerActiveUser", isInvisible: false, isSecondary: false, expression: "add_to_carts/active_users", benchmarkingRequested: true },
        { name: "transactionsPerActiveUser", isInvisible: false, isSecondary: false, expression: "transactions/active_users", benchmarkingRequested: true },
        { name: "transactionsPerBuyer", isInvisible: false, isSecondary: false, expression: "transactions/total_buyers", benchmarkingRequested: true, comment: "Transactions Per Purchaser" },
        { name: "eventCountPerUser", isInvisible: false, isSecondary: false, expression: "event_count/active_users", benchmarkingRequested: true, comment: "Event Count Per Active User" },
        { name: "eventsPerSession", isInvisible: false, isSecondary: false, expression: "event_count/total_sessions", benchmarkingRequested: true },
        { name: "screenPageViewsPerUser", isInvisible: false, isSecondary: false, expression: "screen_page_views/active_users", benchmarkingRequested: true, comment: "Views Per Active User" },
        { name: "screenPageViewsPerSession", isInvisible: false, isSecondary: false, expression: "screen_page_views/total_sessions", benchmarkingRequested: true, comment: "Views Per Session" },
        { name: "averageRevenuePerBuyer", isInvisible: false, isSecondary: false, expression: "revenue/total_buyers", benchmarkingRequested: true, comment: "ARPPU" },
        { name: "averageCombinedRevenuePerUser", isInvisible: false, isSecondary: false, expression: "(total_ad_revenue + revenue - refund_value)/active_users", benchmarkingRequested: true, comment: "ARPU" },
        { name: "averageTransactionRevenue", isInvisible: false, isSecondary: false, expression: "revenue/transactions", benchmarkingRequested: true, comment: "Average Purchases Revenue" },
        { name: "averageRevenuePerUser", isInvisible: false, isSecondary: false, expression: "revenue/active_users", benchmarkingRequested: true, comment: "Average Purchases Revenue Per Active User" },
        { name: "averageTotalAdRevenuePerUser", isInvisible: false, isSecondary: false, expression: "total_ad_revenue/active_users", benchmarkingRequested: true, comment: "Total ad Revenue Per Active User" },
        { name: "averageSessionDuration", isInvisible: false, isSecondary: false, expression: "session_duration_seconds/total_sessions", benchmarkingRequested: true, comment: "Average Session Duration" },
        { name: "bounceRate", isInvisible: false, isSecondary: false, expression: "(total_sessions-total_engaged_sessions)/total_sessions", benchmarkingRequested: true },
        { name: "engagedSessionsPerUser", isInvisible: false, isSecondary: false, expression: "total_engaged_sessions/active_users", benchmarkingRequested: true, comment: "Engaged Sessions Per Active User" },
        { name: "engagementRate", isInvisible: false, isSecondary: false, expression: "total_engaged_sessions/total_sessions", benchmarkingRequested: true },
        { name: "session_conversion_rate", isInvisible: false, isSecondary: false, benchmarkingRequested: true, comment: "Session Key Event Rate" },
        { name: "sessionsPerUser", isInvisible: false, isSecondary: false, expression: "total_sessions/active_users", benchmarkingRequested: true, comment: "Sessions Per Active User" },
        { name: "userEngagementDurationPerUser", isInvisible: false, isSecondary: false, expression: "user_engagement_duration/active_users", benchmarkingRequested: true, comment: "Average Engagement Time Per Active User" },
        { name: "userEngagementDurationPerSession", isInvisible: false, isSecondary: false, expression: "user_engagement_duration/total_sessions", benchmarkingRequested: true, comment: "Average Engagement Time Per Session" },
        { name: "dauMau", isInvisible: false, isSecondary: false, expression: "active_users_1/active_users_30", benchmarkingRequested: true, comment: "DAU/MAU" },
        { name: "dauWau", isInvisible: false, isSecondary: false, expression: "active_users_1/active_users_7", benchmarkingRequested: true, comment: "DAU/WAU" },
        { name: "firstTimeBuyerConversion", isInvisible: false, isSecondary: false, expression: "first_time_buyers/active_users", benchmarkingRequested: true, comment: "FTP Rate" },
        { name: "firstTimeBuyersPerNewUser", isInvisible: false, isSecondary: false, expression: "first_time_buyers/new_users", benchmarkingRequested: true, comment: "FTPs Per New User" },
        { name: "newUserRate", isInvisible: false, isSecondary: false, expression: "new_users/active_users", benchmarkingRequested: true },
        { name: "pmauDau", isInvisible: false, isSecondary: false, expression: "paid_active_users_30/active_users_1", benchmarkingRequested: true, comment: "PMAU/DAU" },
        { name: "buyerConversion", isInvisible: false, isSecondary: false, expression: "total_buyers/active_users", benchmarkingRequested: true, comment: "Purchase Rate" },
        { name: "user_conversion_rate", isInvisible: false, isSecondary: false, benchmarkingRequested: true, comment: "User Key Event Rate" },
        { name: "wauMau", isInvisible: false, isSecondary: false, expression: "active_users_7/active_users_30", benchmarkingRequested: true, comment: "WAU/MAU" },
      ],
      metricFilters: [],
      cardName: "summary_intelligent-home",
      cardId: "00",
      requestGrandTotal: true,
      benchmarkingSpec: { groupId: groupId.toString() },
      rowAxis: {
        fieldNames: ["nth_day"],
        sorts: [{ fieldName: "nth_day", sortType: 1, isDesc: false, pivotSortInfos: [] }],
        limit: 5000,
        offset: 0,
        metaAggTypes: []
      }
    };
  }
}

// ▶️ Lancer le script
extractBenchmarkingData()
  .then(data => {
    // Traitement complémentaire si nécessaire
  })
  .catch(error => console.error('An error occurred:', error));