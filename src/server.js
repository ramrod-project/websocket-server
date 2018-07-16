// Express server to serve websockets to the frontend
// Primarily used to connect the frontend with RethinkDB changefeeds
// to update job status/output/etc.

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express = require("express");
var http = require("http");
var WebSocket = require("ws");
var rdb = require("rethinkdb");
var app = express();

app.get("/", function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

// Create http server to initialize the 
// websockets server.
var server = http.createServer(app);

// Check environment
var rethinkHost = "";
var rethinkPort = 28015;
if (process.env.STAGE === "TESTING") {
    rethinkHost = "localhost";
} else {
    rethinkHost = "rethinkdb";
}

// Create connection to Rethinkdb
/*var connection = null;
function reconnect() {
    return new Promise((resolve, reject) => {
        setTimeout(() => rdb.connect( 
            {host: rethinkHost, port: rethinkPort},
            function(err, returnedConnection) {
                if (err) throw err;
                console.log("Connected to rethinkdb at: " + rethinkHost + ":" + rethinkPort);
                resolve(returnedConnection);
            }), 1000);
    });
}
reconnect()
.then(conn => connection = conn);*/
var connection = null;
rdb.connect( {host: rethinkHost, port: rethinkPort}, function(err, conn) {
    if (err) throw err;
    connection = conn;
});

// Create websocket server using http server
var wss = new WebSocket.Server({ server: server, path: "/monitor" });

// Error catching
wss.on("error", function (err) {
    console.log(err);
});

// Heartbeat
function heartbeat () {
    this.isAlive = true;
}

// Define Websockets listener callbacks for
// handling incoming connections
wss.on("connection", function (ws) {

    // Live connection detection
    ws.isAlive = true;
    ws.on("pong", heartbeat);

    // Log closed connections
    ws.on("close", function (code, reason) {
        console.log("Connection closed because:", reason, "giving code:", code);
    });

    // Handle reception of Websockets messages from 
    // speaker client. 
    ws.on("message", function (message) {

        // Switch statement to determine which changefeed
        // to subscribe to.
        // This handler "routes" all incoming websocket connection initial
        // setups.
        switch (message) {
        // Handle job status monitoring
        case "status":
            if (connection.open) {
                ws.send("Waiting for changes in job statuses...");
                rdb.db("Brain").table("Jobs").filter(rdb.row("Status").ne("Ready"))
                    .changes({includeInitial: true,
                              squash: false})
                    .run(connection, function (err, cursor) {
                        if (err) throw err;
                        cursor.each(function (err, row) {
                            if (err) throw err;
                            //console.warn(row);
                            if ( ("old_val" in row ) &&
                                 ("new_val" in row && row.new_val !== null) &&
                                 ("Status" in row.new_val) &&
                                 (
                                   (row.old_val  == null)
                                   ||
                                   (  (row.old_val  !== null)&&
                                      ("Status" in row.old_val ) &&
                                      (row.old_val.Status != row.new_val.Status)
                                   )
                                 ) &&
                                 (ws.readyState == 1) ){
                                    var sendData = {"id":row.new_val.id, "status":row.new_val.Status};
                                    ws.send(JSON.stringify(sendData, null, 2));
                            } else {
                                return null;
                            }
                        });
                    });
            } else {
                console.log("Connection closed! Reconnecting...");
                // reconnect();
            }
            break;
        // Handle job output monitoring
        case "output":
            if (connection.open) {
                ws.send("Waiting for changes in job outputs...");
                rdb.db("Brain").table("Outputs")
                    .changes({includeInitial: true})
                    .run(connection, function (err, cursor) {
                        if (err) throw err;
                        cursor.each(function (err, row) {
                            if (err) throw err;
                            if ("old_val" in row && (!(row.old_val === null) || (row.new_val === null))) {
                                return null;
                            }
                            var sendData = {"id":row.new_val.OutputJob.id, "content":row.new_val.Content};
                            ws.send(JSON.stringify(sendData, null, 2));
                        });
                    });
            } else {
                console.log("Connection closed! Reconnecting...");
                // reconnect();
            }
            break;
        default:
            ws.send(message + " not a valid feed!");
        }

    });

    // Verify connection with immediate response to 
    // speaker.
    ws.send("Websocket connection established. Awaiting feed selection...");

});

// Check each Websockets client connections to see if it is 
// still alive. If not, terminate the websocket.
var clientCheck = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive == false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping((err) => {Error(err);});
    });
}, 500);

// Start HTTP server on either port 3000 or the port specified
// by the environment variable PORT
server.listen(process.env.PORT || 3000, function () {
    console.log("Server started on port " + server.address().port);
});

module.exports = app;