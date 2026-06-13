#include "net/Http.hpp"

// Platform-specific HTTP GET. On Windows we use WinHTTP (ships with the OS), so
// the resulting .exe needs no libcurl and stays dependency-light. Elsewhere we
// use libcurl.

#ifdef _WIN32
// ---------------------------------------------------------------------------
// Windows: WinHTTP
// ---------------------------------------------------------------------------
#include <windows.h>
#include <winhttp.h>
#include <string>

static std::wstring widen(const std::string& s) {
    // Binance/Stooq URLs are ASCII, so a byte-wise widen is sufficient.
    return std::wstring(s.begin(), s.end());
}

HttpResponse httpGet(const std::string& url, long timeoutSec) {
    HttpResponse r;
    const std::wstring wurl = widen(url);

    URL_COMPONENTS uc;
    ZeroMemory(&uc, sizeof(uc));
    uc.dwStructSize = sizeof(uc);
    wchar_t host[256] = {0}, path[4096] = {0}, extra[4096] = {0};
    uc.lpszHostName    = host;  uc.dwHostNameLength    = ARRAYSIZE(host);
    uc.lpszUrlPath     = path;  uc.dwUrlPathLength     = ARRAYSIZE(path);
    uc.lpszExtraInfo   = extra; uc.dwExtraInfoLength   = ARRAYSIZE(extra);

    if (!WinHttpCrackUrl(wurl.c_str(), static_cast<DWORD>(wurl.size()), 0, &uc)) {
        r.error = "WinHttpCrackUrl failed";
        return r;
    }
    const std::wstring object = std::wstring(path) + extra;
    const bool secure = (uc.nScheme == INTERNET_SCHEME_HTTPS);

    HINTERNET hSession = WinHttpOpen(L"borsa/1.0",
                                     WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                     WINHTTP_NO_PROXY_NAME,
                                     WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) { r.error = "WinHttpOpen failed"; return r; }

    const DWORD ms = static_cast<DWORD>(timeoutSec) * 1000;
    WinHttpSetTimeouts(hSession, ms, ms, ms, ms);

    HINTERNET hConnect = WinHttpConnect(hSession, host, uc.nPort, 0);
    if (!hConnect) {
        r.error = "WinHttpConnect failed";
        WinHttpCloseHandle(hSession);
        return r;
    }

    HINTERNET hRequest = WinHttpOpenRequest(
        hConnect, L"GET", object.c_str(), nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
        secure ? WINHTTP_FLAG_SECURE : 0);
    if (!hRequest) {
        r.error = "WinHttpOpenRequest failed";
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return r;
    }

    BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                 WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    if (ok) ok = WinHttpReceiveResponse(hRequest, nullptr);

    if (ok) {
        DWORD code = 0, len = sizeof(code);
        WinHttpQueryHeaders(hRequest,
                            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &code, &len,
                            WINHTTP_NO_HEADER_INDEX);
        r.status = static_cast<long>(code);

        for (;;) {
            DWORD avail = 0;
            if (!WinHttpQueryDataAvailable(hRequest, &avail) || avail == 0) break;
            std::string chunk;
            chunk.resize(avail);
            DWORD read = 0;
            if (!WinHttpReadData(hRequest, &chunk[0], avail, &read)) break;
            chunk.resize(read);
            r.body += chunk;
        }
    } else {
        r.error = "WinHttp request failed (code " +
                  std::to_string(static_cast<int>(GetLastError())) + ")";
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return r;
}

#else
// ---------------------------------------------------------------------------
// POSIX: libcurl
// ---------------------------------------------------------------------------
#include <curl/curl.h>
#include <mutex>

namespace {

// curl_global_init is not thread-safe, so run it exactly once.
void ensureGlobalInit() {
    static std::once_flag flag;
    std::call_once(flag, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

size_t writeCb(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* out = static_cast<std::string*>(userdata);
    out->append(ptr, size * nmemb);
    return size * nmemb;
}

} // namespace

HttpResponse httpGet(const std::string& url, long timeoutSec) {
    ensureGlobalInit();

    HttpResponse resp;
    CURL* curl = curl_easy_init();
    if (!curl) {
        resp.error = "curl_easy_init failed";
        return resp;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp.body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSec);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "borsa/1.0");
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

    CURLcode rc = curl_easy_perform(curl);
    if (rc != CURLE_OK) {
        resp.error = curl_easy_strerror(rc);
    } else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &resp.status);
    }
    curl_easy_cleanup(curl);
    return resp;
}

#endif
