#pragma once
// Minimal blocking HTTP GET on top of libcurl. Called only from worker threads.

#include <string>

struct HttpResponse {
    long        status = 0;   // HTTP status code (0 if the request never completed)
    std::string body;
    std::string error;        // non-empty on transport-level failure
};

HttpResponse httpGet(const std::string& url, long timeoutSec = 20);
