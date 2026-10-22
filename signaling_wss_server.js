const fs = require('fs');
const https = require('https');
const ws = require('ws');

// Read SSL certificate and private key
const privateKey = fs.readFileSync('./certificates/server.key', 'utf8');
const certificate = fs.readFileSync('./certificates/server.cert', 'utf8');

const credentials = {
  key: privateKey,
  cert: certificate
};

const args = process.argv;

// Create an HTTPS server with the SSL credentials
const httpsServer = https.createServer(credentials);
httpsServer.listen(args[3], args[2], () => {
  console.log("Starting Signaling Server at " + args[2] + ":" + args[3]);
});

// Create the WebSocket server on top of the HTTPS server
const wss = new ws.Server({ server: httpsServer });

//all connected to the server users
var users = new Map();
var currNumPlayers = new Map();
var userNames = new Set();
var userGroups = new Set();

//number of players to connect
var totalNumPlayers = 0;

// --- Lobby protocol -------------------------------------------------------
// Independent of the login/offer/answer/candidate WebRTC handshake above —
// this only coordinates party-slot assignment and readiness for a UI lobby
// before the WASM module's own networking (the code above) ever connects.
// Never carries player input values, only room settings and ready signals.
// room -> { size, t, program, slots: [connection|null,...], ready: [bool,...] }
var lobbies = new Map();

function lobbyStatus(lobby) {
   return {
      type: "lobby_status",
      size: lobby.size,
      connected: lobby.slots.filter(function (s) { return s != null; }).length,
      ready: lobby.ready.slice()
   };
}

function broadcastLobby(lobby, message) {
   lobby.slots.forEach(function (conn) {
      if (conn != null) sendTo(conn, message);
   });
}

function maybeStartLobby(room, lobby) {
   var full = lobby.slots.every(function (s) { return s != null; });
   var allReady = lobby.ready.every(Boolean);
   if (full && allReady) {
      broadcastLobby(lobby, {
         type: "lobby_start",
         size: lobby.size,
         t: lobby.t,
         program: lobby.program
      });
   }
}

function lobbyLeave(connection) {
   if (!connection.lobbyRoom) return;
   var lobby = lobbies.get(connection.lobbyRoom);
   if (!lobby) return;
   var idx = connection.lobbyIndex;
   if (lobby.slots[idx] === connection) {
      lobby.slots[idx] = null;
      lobby.ready[idx] = false;
   }
   if (lobby.slots.every(function (s) { return s == null; })) {
      lobbies.delete(connection.lobbyRoom);
   } else {
      broadcastLobby(lobby, lobbyStatus(lobby));
   }
}

wss.on('connection', function(connection) {
   connection.on('message', function(message) {	
      var data; 
      try {
         data = JSON.parse(message); 
      } catch (e) { 
         console.log("Invalid JSON");
         data = {}; 
      } 
      switch (data.type) { 		
         case "login": 				
            //if anyone is logged in with this username then refuse
            if(userGroups.has(data.group) && (typeof users[data.group][data.name] !== 'undefined')) {
               console.log("Usergroup: " + data.group + " name: " + data.name + " has " + users[data.group][data.name]); 
               sendTo(connection, { 
                  type: "login", 
                  success: false,
                  message: "Username is unavailable!"
               });
              } else if((userNames.size != 0) && (totalNumPlayers != data.content)) {
                console.log("Number of players " + data.content + " does not match with other players.");
                console.log("Current number of players: " + userNames.size);
                sendTo(connection, {
                    type: "login",
                    success: false,
                    message: "Number of players does not match!"
                });
            } else {
               // first player sets the number of players
               if(userNames.size == 0)
                  totalNumPlayers = data.content;
 
               // save user connection on the server
               if(currNumPlayers[data.group] == null) {
                  currNumPlayers[data.group] = 0;
                  users[data.group] = Array.apply(null, Array(totalNumPlayers)).map(function () {});
               }

               users[data.group][data.name] = connection;
               userNames.add(data.name);
               userGroups.add(data.group);
               connection.name = data.group + '/' + data.name; 
               currNumPlayers[data.group]++;
					
               sendTo(connection, { 
                  type: "login", 
                  success: true 
               });
               console.log(connection.name, "logged in");
               
               // notify all players when all players have logged in
               if(currNumPlayers[data.group] == totalNumPlayers) {
                  console.log("All players have logged in");
                  for(let i of users[data.group]) {
                     sendTo(i, {
                        type: "start",
                        players: totalNumPlayers
                     });
                  }
               }
            } 
            break; 
				
         case "offer": 
            console.log("Sending offer from " + connection.name + " to: " + data.group + '/' + data.name); 
            var conn = users[data.group][data.name];
            if(conn != null) { 
               connection.otherName = data.group + '/' + data.name; 
               sendTo(conn, { 
                  type: "offer", 
                  group: connection.name.split('/')[0],
                  name: connection.name.split('/')[1],
                  offer: data.content
               }); 
            } else {
               console.log("Offer not sent");
            }
            break;  
				
         case "answer": 
            console.log("Sending answer from " + connection.name + " to: " + data.group + '/' + data.name);
            var conn = users[data.group][data.name];
				
            if(conn != null) { 
               connection.otherName = data.group + '/' + data.name; 
               sendTo(conn, { 
                  type: "answer", 
                  name: connection.name, 
                  answer: data.content
               }); 
            } else {
               console.log("Answer not sent");
            }
				
            break;  

         case "candidate":
            console.log("Sending candidate from " + connection.name + " to: " + data.group + '/' + data.name);
            var conn = users[data.group][data.name];
            if(conn != null) {
               sendTo(conn, {
                  type: "candidate",
                  name: connection.name,
                  mId: data.mId,
                  candidate: data.content
               });
            } else
               console.log("Candidate not sent");
            break;
	
         case "lobby_join": {
            var room = String(data.room || "default");
            var lobby = lobbies.get(room);
            if (!lobby) {
               var size = Math.max(1, parseInt(data.size, 10) || 4);
               lobby = {
                  size: size,
                  t: data.t != null ? String(data.t) : "1",
                  program: String(data.program || "surplus_matching_private"),
                  slots: Array(size).fill(null),
                  ready: Array(size).fill(false)
               };
               lobbies.set(room, lobby);
            }
            var freeIndex = lobby.slots.indexOf(null);
            if (freeIndex === -1) {
               sendTo(connection, { type: "lobby_error", message: "Room '" + room + "' is full." });
               break;
            }
            lobby.slots[freeIndex] = connection;
            connection.lobbyRoom = room;
            connection.lobbyIndex = freeIndex;
            sendTo(connection, {
               type: "lobby_assigned",
               index: freeIndex,
               size: lobby.size,
               t: lobby.t,
               program: lobby.program
            });
            broadcastLobby(lobby, lobbyStatus(lobby));
            console.log("lobby_join: room=" + room + " index=" + freeIndex + "/" + lobby.size);
            break;
         }

         case "lobby_ready": {
            if (!connection.lobbyRoom) break;
            var lobby = lobbies.get(connection.lobbyRoom);
            if (!lobby) break;
            lobby.ready[connection.lobbyIndex] = !!data.ready;
            broadcastLobby(lobby, lobbyStatus(lobby));
            maybeStartLobby(connection.lobbyRoom, lobby);
            break;
         }

         default:
            sendTo(connection, {
               type: "error",
               message: "Unknown message type: " + data.type
            });
            break;
      }
   });

   // when user exits/closes the browser window or established webrtc connections
   connection.on("close", function() {
      lobbyLeave(connection);
      if(connection.name) {
         var group = connection.name.split('/')[0];
         var name = connection.name.split('/')[1];
         users[group][name] = undefined;
         currNumPlayers[group]--;

         if(currNumPlayers[group] == 0) {
            userGroups.delete(group);
            users.delete(group);
         }
         console.log("Disconnected from", connection.name);
      }
      if(!userGroups || userGroups.size == 0) {
         console.log("All players have disconnected");
         userNames.clear();
         // setTimeout(shutDown, 3000); // wait 3 seconds before shutting down server
      } 
   });  	
});  

function sendTo(connection, message) {
   connection.send(JSON.stringify(message)); 
}

function shutDown() {
   console.log("All Players disconnected. Shut down server now...");
   wss.close();
}