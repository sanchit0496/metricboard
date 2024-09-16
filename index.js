const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

// Base directory
const metricDir = path.join(process.cwd(), "metrics");

// Middleware to log metrics and generate reports per microservice
function metricboard(req, res, next) {
  const start = Date.now();
  let logged = false;

  function logOnce() {
    if (!logged) {
      logResponse(req, res, start);
      logged = true;
    }
  }

  res.on("finish", logOnce);
  res.on("close", logOnce);

  next();
}

// Log response per microservice
function logResponse(req, res, start) {
  const responseTime = Date.now() - start;

  // Extract the microservice name from the request
  const microserviceName = getMicroserviceName(req); // You can define this function to get the microservice name
  const microserviceDir = path.join(metricDir, microserviceName);
  const logFilePath = path.join(microserviceDir, "metrics.json");
  const reportFilePath = path.join(microserviceDir, "report.html");

  const logEntry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    reqSize: parseInt(req.headers["content-length"] || 0),
    resSize: parseInt(res.getHeader("Content-Length") || 0),
    responseTime: responseTime,
    payload: req.body,
    urlParams: req.params,
    queryParams: req.query,
  };

  let metrics = [];
  ensureDirectoryExistence(microserviceDir); // Create directory for each microservice
  ensureFileExistence(logFilePath); // Ensure log file exists for each microservice

  try {
    const existingMetrics = JSON.parse(fs.readFileSync(logFilePath, "utf8"));
    existingMetrics.push(logEntry);
    metrics = existingMetrics;
    fs.writeFileSync(logFilePath, JSON.stringify(metrics, null, 2), "utf8");
  } catch (error) {
    console.error(`Error writing to log file for ${microserviceName}:`, error);
  }

  // Generate the report for the specific microservice
  generateReport(microserviceName, metrics, reportFilePath);

  // Generate endpoint-specific reports for all unique top-level endpoints
  const uniqueEndpoints = extractUniqueEndpoints(metrics);
  uniqueEndpoints.forEach((endpoint) => {
    generateEndpointReport(metrics, endpoint, microserviceName);
  });
}

// Function to determine the microservice name from the request
function getMicroserviceName(req) {
  // Example: Use the first part of the URL as the microservice name
  const servicePath = req.originalUrl.split("/")[1]; // Assuming /microserviceName/...
  return servicePath || "default_service"; // If no service path, fallback to default
}

// Ensure directory exists
function ensureDirectoryExistence(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Ensure file exists
function ensureFileExistence(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
  }
}

// Function to extract unique top-level endpoints
function extractUniqueEndpoints(metrics) {
  const uniqueEndpoints = new Set();
  metrics.forEach((entry) => {
    const urlParts = entry.url.split("/");
    if (urlParts.length > 4) {
      const topLevelEndpoint = `/${urlParts[1]}/${urlParts[2]}/${urlParts[3]}/${urlParts[4]}/`;
      uniqueEndpoints.add(topLevelEndpoint);
    }
  });
  return Array.from(uniqueEndpoints);
}

// Generate report per microservice
function generateReport(microserviceName, metrics, reportFilePath) {
  // Calculate the distribution of HTTP methods
  const methodCounts = metrics.reduce((acc, entry) => {
    acc[entry.method] = (acc[entry.method] || 0) + 1;
    return acc;
  }, {});

  // Calculate the distribution of specific status codes
  const statusCounts = metrics.reduce((acc, entry) => {
    acc[entry.statusCode] = (acc[entry.statusCode] || 0) + 1;
    return acc;
  }, {});

  // Calculate response time metrics
  const responseTimes = metrics.map((entry) => entry.responseTime);
  const payloadSizes = metrics.map((entry) => {
    const payload = entry.payload ? JSON.stringify(entry.payload).length : 0;
    return payload;
  });

  const slowestResponse = Math.max(...responseTimes);
  const fastestResponse = Math.min(...responseTimes);
  const medianResponse = calculateMedian(responseTimes);
  const avgPayloadSize = calculateAverage(payloadSizes);
  const totalApiCalls = metrics.length;

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split("T")[0];

  const methodLabels = Object.keys(methodCounts);
  const methodData = Object.values(methodCounts);

  const statusLabels = Object.keys(statusCounts);
  const statusData = Object.values(statusCounts);

  // Render the HTML report with logs, charts, and filters
  const template = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MetricBoard - ${microserviceName}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        h1, h2 { color: #444; }
        .chart-container { display: flex; justify-content: space-evenly; margin-bottom: 20px; }
        .chart-container canvas { width: 45%; height: auto; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; background-color: #fff; }
        table, th, td { border: 1px solid #ddd; }
        th, td { padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .pagination { display: flex; justify-content: center; margin: 20px 0; }
        .pagination button { margin: 0 5px; padding: 10px 20px; border: 1px solid #007bff; background-color: #007bff; color: #fff; cursor: pointer; border-radius: 4px; }
        .pagination button:disabled { background-color: #ccc; cursor: not-allowed; }
        .pagination span { padding: 10px 20px; }
        input[type="text"], input[type="date"], select {
            margin: 10px 0;
            padding: 10px;
            width: calc(100% - 20px);
            box-sizing: border-box;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
        input[type="text"]:focus, input[type="date"]:focus, select:focus {
            outline: none;
            border-color: #007bff;
        }
        .filter-container {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }
        .filter-container div {
            flex: 1;
            min-width: 250px;
        }
        /* Style for the entire log entry container */
.log-entry {
    background-color: #f9f9f9;
    border: 1px solid #ddd;
    padding: 10px;
    margin-bottom: 10px;
    border-radius: 5px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    font-family: Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
}

/* Highlight different methods */
.log-entry strong {
    color: #333;
    font-size: 16px;
}

.log-entry .payload {
    background-color: #f0f0f0;
    padding: 10px;
    margin-top: 5px;
    font-family: monospace;
    white-space: pre-wrap; /* Keep JSON format readable */
    border-left: 4px solid #0360aa;
}

.log-entry .log-status {
    font-weight: bold;
    color: #28a745; /* Green for success status */
}

.log-entry .log-error {
    font-weight: bold;
    color: #dc3545; /* Red for error status */
}

/* Style the log methods differently */
.log-entry .log-method {
    font-weight: bold;
}

.log-entry .log-method.POST,
.log-entry .log-method.PUT {
    color: #007bff; /* Blue for POST/PUT */
}

.log-entry .log-method.GET {
    color: #28a745; /* Green for GET */
}

.log-entry .log-method.DELETE {
    color: #dc3545; /* Red for DELETE */
}
.timestamp{
    color: #0360aa;
    font-weight: 600;
}

h2{
 
    margin: 60px 0px 20px 0px;
    color: #2929a9;
}

h1{
    color: #2929a9;
    
    text-align: center; 
}
h3{
    color: #2929a9;
}
#nextPage, #prevPage{
    background-color: #2929a9;
}
    </style>
</head>
<body>
    <h1>MetricBoard For ${microserviceName} : ${totalApiCalls} Requests</h1>

    <div class="chart-container">
        <div>
            <h3>API Call Methods Distribution</h3>
            <canvas id="methodChart"></canvas>
        </div>
        <div>
            <h3>API Status Code Distribution</h3>
            <canvas id="statusChart"></canvas>
        </div>
    </div>

    <h2>Response Time Metrics</h2>
    <table>
        <tr><th>Slowest Response</th><td>${slowestResponse} ms</td></tr>
        <tr><th>Fastest Response</th><td>${fastestResponse} ms</td></tr>
        <tr><th>Median Response Time</th><td>${medianResponse} ms</td></tr>
        <tr><th>Average Payload Size</th><td>${avgPayloadSize.toFixed(2)} bytes</td></tr>
    </table>

    <h2>Total Requests Over Time</h2>
    <input type="date" id="datePicker" value="${today}" />
    <canvas id="requestsOverTimeChart"></canvas>

    <h2>Logged API Calls</h2>
    <div class="filter-container">
        <div><input type="text" id="logFilterStatus" placeholder="Filter by Status Code" /></div>
        <div><input type="text" id="logFilterMethod" placeholder="Filter by Method" /></div>
    </div>
    <div id="logsContainer"></div>
    <div class="pagination">
        <button id="prevPage">Previous</button>
        <span id="pageInfo"></span>
        <button id="nextPage">Next</button>
    </div>

    <script>
        document.addEventListener("DOMContentLoaded", function() {
            const methodLabels = ${JSON.stringify(methodLabels)};
            const methodData = ${JSON.stringify(methodData)};
            const statusLabels = ${JSON.stringify(statusLabels)};
            const statusData = ${JSON.stringify(statusData)};
            const metrics = ${JSON.stringify(metrics)};

            // Method Distribution Chart
            const methodCtx = document.getElementById('methodChart').getContext('2d');
            new Chart(methodCtx, {
                type: 'pie',
                data: {
                    labels: methodLabels,
                    datasets: [{ data: methodData, backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'] }]
                }
            });

            // Status Code Distribution Chart
            const statusCtx = document.getElementById('statusChart').getContext('2d');
            new Chart(statusCtx, {
                type: 'pie',
                data: {
                    labels: statusLabels,
                    datasets: [{ data: statusData, backgroundColor: ['#4BC0C0', '#FF6384', '#FFCE56', '#36A2EB', '#9966FF'] }]
                }
            });

            // Requests Over Time Chart
            let requestsOverTimeChart;
function updateRequestsOverTimeChart(date) {
    const filteredMetrics = metrics.filter(function(entry) {
        return new Date(entry.timestamp).toISOString().split('T')[0] === date;
    });
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const requestCounts = hours.map(function(hour) {
        return filteredMetrics.filter(function(entry) {
            return new Date(entry.timestamp).getHours() === hour;
        }).length;
    });

    if (requestsOverTimeChart) {
        requestsOverTimeChart.destroy();
    }

    const requestsOverTimeCtx = document.getElementById('requestsOverTimeChart').getContext('2d');
    requestsOverTimeChart = new Chart(requestsOverTimeCtx, {
        type: 'line',
        data: {
            labels: hours.map(function(hour) { return hour + ":00"; }),
            datasets: [{
                label: 'API Requests',
                data: requestCounts,
                borderColor: '#FF6384',
                fill: false
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true, // Start Y-axis at 0
                    ticks: {
                        // Ensure only whole numbers are displayed
                        callback: function(value) {
                            if (Number.isInteger(value)) {
                                return value; // Return whole numbers only
                            }
                            return null; // Skip non-integer values
                        }
                    }
                }
            }
        }
    });
}


            document.getElementById('datePicker').addEventListener('change', function() {
                updateRequestsOverTimeChart(this.value);
            });

            updateRequestsOverTimeChart('${today}');

            // Display API Logs with Pagination and Filtering
            let currentPage = 1;
            const recordsPerPage = 10;

            function displayLogs(page) {
                page = page || 1;
                const filterStatus = document.getElementById('logFilterStatus').value.toLowerCase();
                const filterMethod = document.getElementById('logFilterMethod').value.toLowerCase();

                const filteredMetrics = metrics.filter(function(entry) {
                    return entry.statusCode.toString().includes(filterStatus) &&
                           entry.method.toLowerCase().includes(filterMethod);
                }).reverse(); // Reverse the array to show the newest logs first

                const startIndex = (page - 1) * recordsPerPage;
                const endIndex = startIndex + recordsPerPage;
                const paginatedMetrics = filteredMetrics.slice(startIndex, endIndex);

                const logsContainer = document.getElementById("logsContainer");
               
                logsContainer.innerHTML = paginatedMetrics.map(function(entry) {
                    let logEntry = "<div class='log-entry'><span  class='timestamp'>" + new Date(entry.timestamp).toLocaleString() + "</span> - " + entry.method + " " + entry.url + " - Status: " + entry.statusCode + " - Response Time: " + entry.responseTime + " ms";
                    if (entry.method === 'POST' || entry.method === 'PUT') {
                        logEntry += "<div class='payload'>Payload: " + JSON.stringify(entry.payload, null, 2) + "</div>";
                    }
                    logEntry += "</div>";
                    return logEntry;
                }).join("");
                

                document.getElementById("pageInfo").textContent = page + " / " + Math.ceil(filteredMetrics.length / recordsPerPage);
                document.getElementById("prevPage").disabled = page <= 1;
                document.getElementById("nextPage").disabled = endIndex >= filteredMetrics.length;
            }


            document.getElementById('logFilterStatus').addEventListener('input', function() {
                displayLogs(1);
            });

            document.getElementById('logFilterMethod').addEventListener('input', function() {
                displayLogs(1);
            });

            document.getElementById('prevPage').addEventListener('click', function() {
                if (currentPage > 1) {
                    currentPage--;
                    displayLogs(currentPage);
                }
            });

            document.getElementById('nextPage').addEventListener('click', function() {
                if (currentPage * recordsPerPage < metrics.length) {
                    currentPage++;
                    displayLogs(currentPage);
                }
            });

            displayLogs();
        });
    </script>
</body>
</html>
`;

  try {
    const html = ejs.render(template);
    fs.writeFileSync(reportFilePath, html, "utf8");
    console.log(`Report generated for ${microserviceName}: ${reportFilePath}`);
  } catch (error) {
    console.error(`Error writing report for ${microserviceName}:`, error);
  }
}

// Helper function to calculate the median
function calculateMedian(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Helper function to calculate the average
function calculateAverage(arr) {
  if (arr.length === 0) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum / arr.length;
}

// Function for endpoint-specific reporting per microservice
function generateEndpointReport(metrics, endpoint, microserviceName) {
  const endpointMetrics = metrics.filter((entry) =>
    entry.url.startsWith(endpoint),
  );

  const responseTimes = endpointMetrics.map((entry) => entry.responseTime);
  const payloadSizes = endpointMetrics.map((entry) => {
    const payload = entry.payload ? JSON.stringify(entry.payload).length : 0;
    return payload;
  });

  const slowestResponse = Math.max(...responseTimes);
  const fastestResponse = Math.min(...responseTimes);
  const medianResponse = calculateMedian(responseTimes);
  const avgPayloadSize = calculateAverage(payloadSizes);

  const totalApiCalls = endpointMetrics.length;
  const endpointMethodCounts = endpointMetrics.reduce((acc, entry) => {
    acc[entry.method] = (acc[entry.method] || 0) + 1;
    return acc;
  }, {});

  const endpointStatusCounts = endpointMetrics.reduce((acc, entry) => {
    acc[entry.statusCode] = (acc[entry.statusCode] || 0) + 1;
    return acc;
  }, {});

  const endpointMethodLabels = Object.keys(endpointMethodCounts);
  const endpointMethodData = Object.values(endpointMethodCounts);

  const endpointStatusLabels = Object.keys(endpointStatusCounts);
  const endpointStatusData = Object.values(endpointStatusCounts);

  const endpointReportTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Metric Board for ${microserviceName}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <h1>Endpoint Metric Report: ${endpoint} - ${microserviceName}</h1>
    <!-- Similar to the main report -->
</body>
</html>
`;

  const endpointReportPath = path.join(
    metricDir,
    microserviceName,
    `${endpoint.replace(/\W/g, "_")}_report.html`,
  );

  try {
    fs.writeFileSync(
      endpointReportPath,
      ejs.render(endpointReportTemplate, {
        endpointMethodLabels,
        endpointMethodData,
        endpointStatusLabels,
        endpointStatusData,
      }),
      "utf8",
    );
    console.log(
      `Endpoint report generated for ${microserviceName}: ${endpointReportPath}`,
    );
  } catch (error) {
    console.error(
      `Error writing endpoint report for ${microserviceName}:`,
      error,
    );
  }
}


module.exports = { metricboard };
