// Unit testing for websockets application

var chai = require("chai");
var expect = require("chai").expect;
var wsclient = require("websocket").client;
var rdb = require("rethinkdb");

chai.use(require("chai-http"));

var app = require("../src/server.js");

var status_connection = null;
var output_connection = null;
var files_connection = null;
var plugs_connection = null;
var rdbconn = null;
var rdbconn_files = null;
var testws = null;

describe("", function () {

    this.timeout(3000);

    const newJob = {
        "id": "t3stid",
        "JobTarget":{
            "PluginName": "advancer",
            "Location": "8.8.8.8",
            "Port": "80"
        },
        "JobCommand":{
            "CommandName": "TestJob",
            "Tooltip": "for testing jobs",
            "Inputs":[]
        },
        "Status": "Waiting",
        "StartTime" : 0
    };

    const newOutput = {
        "OutputJob":{
            "id": "t3stid",
            "JobTarget":{
                "PluginName": "advancer",
                "Location": "8.8.8.8",
                "Port": "80"
            },
            "JobCommand":{
                "CommandName": "TestJob",
                "Tooltip": "for testing jobs",
                "Inputs":[]
            },
            "Status": "Waiting",
            "StartTime" : 0
        },
        "Content": "Test output content"
    };

    before(function (done) {
        testws = new wsclient();
        testws2 = new wsclient();
        testws_files = new wsclient();
        testws_plugins = new wsclient();
        rdb.connect( {host: "localhost", port: 28015}, function(err, conn) {
            if (err) throw err;
            rdbconn = conn;
            rdb.db("Brain").tableList().run(rdbconn, function (err, result) {
                if (err) throw err;
                done();
            });
        });
        rdb.connect( {host: "localhost", port: 28015}, function(err, conn) {
            if (err) throw err;
            rdbconn_files = conn;
            rdb.db("Brain").tableList().run(rdbconn, function (err, result) {
                if (err) throw err;
                done();
            });
        });
    });

    after(function(done) {
        status_connection.close();
        output_connection.close();
        files_connection.close();
        plugs_connection.close();
        rdb.db("Brain").table("Jobs").delete().run(rdbconn, function (err, result) {
            if (err) done(err);
            rdb.db("Brain").table("Outputs").delete().run(rdbconn, function (err, result) {
                if (err) done(err);
                done();
            });
        });
    });

    it("should confirm Websockets connection", function (done) {
        testws.on("connect", function (conn) {
            if (conn.connected) {
                status_connection = conn;
                status_connection.once("message", function (message) {
                    expect(typeof(message.utf8Data)).to.equal("string");
                    expect(message.utf8Data).equal("Websocket connection established. Awaiting feed selection...");
                    done();
                });
            }
        });
        testws.connect("ws://localhost:3000/monitor");
    });

    it("should confirm Rethinkdb status feed connection", function (done) {
        if (status_connection.connected) {
            status_connection.once("message", function (message) {
                expect(typeof(message.utf8Data)).to.equal("string");
                expect(message.utf8Data).equal("Waiting for changes in job statuses...");
                done();
            });
            status_connection.send("status");
        }
    });

    it("should not open feed on invalid parameter", function (done) {
        if (status_connection.connected) {
            const invalidSelection = "foo";
            status_connection.once("message", function (message) {
                expect(typeof(message.utf8Data)).to.equal("string");
                expect(message.utf8Data).equal("foo not a valid feed!");
                done();
            });
            status_connection.send(invalidSelection);
        }
    });

    it("should push job status updates to client", function (done) {
        if (status_connection.connected) {
            status_connection.once("message", function (message) {
                expect(typeof(JSON.parse(message.utf8Data))).to.equal("object");
                data = JSON.parse(message.utf8Data);
                expect(data.status).to.equal("Done");
                done();
            });
        }
        rdb.db("Brain").table("Jobs").insert(newJob)
        .run(rdbconn, function (err, result) {
            if (err) throw err;
            rdb.db("Brain").table("Jobs").get("t3stid")
            .update({"Status": "Done"})
            .run(rdbconn, function (err, result) {
                if (err) throw err;
            });
        });
    });

    it("should not push status updates when status is the same", function (done) {
        var EXPECTED_TIMEOUT = this.timeout - 100;
        var timeout = setTimeout(done, EXPECTED_TIMEOUT); // This will call done when timeout is reached.
        if (status_connection.connected) {
            status_connection.once("message", function (message) {
                if (!(message.utf8Data === ("Waiting for changes in job outputs..." || "Waiting for changes in job statuses..."))) {
                    clearTimeout(timeout);
                    // this should never happen, is the expected behavior.
                    done(new Error("Should not have received message" + message.utf8Data));
                }
            });
        }
        rdb.db("Brain").table("Jobs").get("t3stid")
        .update({"StartTime": 1})
        .run(rdbconn, function (err, result) {
            if (err) throw err;
        });
    });

    it("should confirm output Websockets connection", function (done) {
        testws2.on("connect", function (conn2) {
            if (conn2.connected) {
                output_connection = conn2;
                output_connection.once("message", function (message) {
                    expect(typeof(message.utf8Data)).to.equal("string");
                    expect(message.utf8Data).equal("Websocket connection established. Awaiting feed selection...");
                    done();
                });
            }
        });
        testws2.connect("ws://localhost:3000/monitor");
    });

    it("should confirm Rethinkdb output feed connection", function (done) {
        if (output_connection.connected) {
            output_connection.once("message", function (message) {
                expect(typeof(message.utf8Data)).to.equal("string");
                expect(message.utf8Data).equal("Waiting for changes in job outputs...");
                done();
            });
            output_connection.send("output");
        }
    });

    it("should push job outputs to client", function (done) {
        if (output_connection.connected) {
            output_connection.once("message", function (message) {
                expect(typeof(JSON.parse(message.utf8Data))).to.equal("object");
                data = JSON.parse(message.utf8Data);
                expect(data.content).to.equal("Test output content");
                expect(data.id).to.equal("t3stid");
                done();
            });
        }
        rdb.db("Brain").table("Outputs").insert(newOutput)
        .run(rdbconn, function (err, result) {
            if (err) throw err;
        });
    });

    // START Plugins Monitor
    it("should confirm Websockets connection", function (done) {
        testws_plugins.on("connect", function (conn4) {
            if (conn4.connected) {
                plugs_connection = conn4;
                plugs_connection.once("message", function (message) {
                    expect(typeof(message.utf8Data)).to.equal("string");
                    expect(message.utf8Data).equal("Websocket connection established. Awaiting feed selection...");
                    done();
                });
            }
        });
        testws_plugins.connect("ws://localhost:3000/monitor");
    });

    it("should confirm plugins feed connection", function (done) {
        if (plugs_connection.connected) {
            plugs_connection.once("message", function (message) {
                expect(typeof(message.utf8Data)).to.equal("string");
                done();
            });
            plugs_connection.send("plugins");
        }
    });

    it("should push a plugins notification to client", function (done) {
        if (plugs_connection.connected) {
            plugs_connection.once("message", function (message) {
                expect(typeof(JSON.parse(message.utf8Data))).to.equal("object");
                data = JSON.parse(message.utf8Data);
                expect(data.changed).to.equal(1);
                done();
            });
        }
        rdb.db("Controller").table("Plugins").insert({"Name": "t3st"})
            .run(rdbconn, function (err, result) {
                if (err) throw err;
            });
    });
    // END Plugins Monitor
    // START FILES TEST
    it("should confirm Websockets connection", function (done) {
        testws_files.on("connect", function (conn3) {
            if (conn3.connected) {
                files_connection = conn3;
                files_connection.once("message", function (message) {
                    expect(typeof(message.utf8Data)).to.equal("string");
                    expect(message.utf8Data).equal("Websocket connection established. Awaiting feed selection...");
                    done();
                });
            }
        });
        testws_files.connect("ws://localhost:3000/monitor");
    });
    it("should confirm files feed connection", function (done) {
        if (files_connection.connected) {
            files_connection.once("message", function (message) {
                expect(typeof(message.utf8Data)).to.equal("string");
                done();
            });
            files_connection.send("files");
        }
    });

    it("should push a file notification to client", function (done) {
        if (files_connection.connected) {
            files_connection.once("message", function (message) {
                expect(typeof(JSON.parse(message.utf8Data))).to.equal("object");
                data = JSON.parse(message.utf8Data);
                expect(data.changed).to.equal(1);
                done();
            });
        }
        rdb.db("Brain").table("Files").insert({"Name":"t3st"})
        .run(rdbconn_files, function (err, result) {
            if (err) throw err;
        });
    });
    // END FILE MONITOR

});

