import dns from "node:dns";

// Configure the resolver before MongoDB performs SRV/TXT discovery.
// Shared by the application connection and the standalone Atlas probe.
dns.setServers(["8.8.8.8", "1.1.1.1"]);
