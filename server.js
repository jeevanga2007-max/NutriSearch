// NutriSearch backend (Node + Express)

require("dotenv").config();

const express = require("express");
const path = require("path");
const productRoutes = require("./routes/products");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(express.json({ limit: "16kb" }));
app.use(function (req, res, next) {
    req.cookies = {};
    const header = req.headers.cookie || "";
    header.split(";").forEach(function (part) {
        const index = part.indexOf("=");
        if (index < 0) return;
        const key = part.slice(0, index).trim();
        try { req.cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { /* Ignore malformed cookies. */ }
    });
    next();
});

// Serve the website (the HTML, CSS and JS in /public)
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api/products", productRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// Unknown /api addresses
app.use("/api", function (req, res) {
    res.status(404).json({ error: "Not found." });
});

// One place that turns any error into a clean JSON answer
app.use(function (error, req, res, next) {
    const status = error.status || 500;
    const message = status === 500 ? "Something went wrong on the server." : error.message;

    if (status === 500) console.error(error);

    res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;

// Only start listening when run directly (so the tests can import "app")
if (require.main === module) {
    app.listen(PORT, function () {
        console.log("NutriSearch running at http://localhost:" + PORT);
    });
}

module.exports = app;
