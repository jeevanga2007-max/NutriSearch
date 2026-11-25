// NutriSearch backend (Node + Express)

require("dotenv").config();

const express = require("express");
const path = require("path");
const productRoutes = require("./routes/products");

const app = express();

app.use(express.json());

// Serve the website (the HTML, CSS and JS in /public)
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api/products", productRoutes);

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
