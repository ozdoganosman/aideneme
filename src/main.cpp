// Entry point: GLFW window + OpenGL3 context + Dear ImGui / ImPlot, then run the
// App's frame loop. GPU-accelerated immediate-mode rendering.

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "implot.h"

#include <GLFW/glfw3.h>
#include <cstdio>

#include "App.hpp"

static void glfwErrorCallback(int error, const char* description) {
    std::fprintf(stderr, "GLFW Error %d: %s\n", error, description);
}

int main(int, char**) {
    glfwSetErrorCallback(glfwErrorCallback);
    if (!glfwInit()) return 1;

    const char* glslVersion = "#version 130";
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);

    GLFWwindow* window = glfwCreateWindow(
        1600, 900, "Borsa — Yuksek Performansli Grafikler", nullptr, nullptr);
    if (!window) {
        glfwTerminate();
        return 1;
    }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);  // vsync

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImPlot::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();

    // DPI-aware scaling + a larger, crisp font. ImGui's built-in 13px font is
    // tiny on modern/high-DPI displays, which made the UI hard to read.
    {
        float xscale = 1.0f, yscale = 1.0f;
        glfwGetWindowContentScale(window, &xscale, &yscale);
        const float uiScale = (xscale > 1.0f ? xscale : 1.0f) * 1.35f;
        const float fontPx  = 17.0f * uiScale;

        const char* candidates[] = {
#ifdef _WIN32
            "C:\\Windows\\Fonts\\segoeui.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
#elif defined(__APPLE__)
            "/System/Library/Fonts/SFNS.ttf",
            "/Library/Fonts/Arial.ttf",
#else
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
#endif
        };
        bool fontLoaded = false;
        for (const char* p : candidates) {
            if (FILE* f = std::fopen(p, "rb")) {
                std::fclose(f);
                io.Fonts->AddFontFromFileTTF(p, fontPx);
                fontLoaded = true;
                break;
            }
        }
        if (!fontLoaded) {
            ImFontConfig cfg;
            cfg.SizePixels = fontPx;
            io.Fonts->AddFontDefault(&cfg);
        }
        ImGui::GetStyle().ScaleAllSizes(uiScale);
    }

    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init(glslVersion);

    {
        App app;
        while (!glfwWindowShouldClose(window)) {
            glfwPollEvents();

            ImGui_ImplOpenGL3_NewFrame();
            ImGui_ImplGlfw_NewFrame();
            ImGui::NewFrame();

            app.draw();

            ImGui::Render();
            int dw, dh;
            glfwGetFramebufferSize(window, &dw, &dh);
            glViewport(0, 0, dw, dh);
            glClearColor(0.07f, 0.07f, 0.09f, 1.0f);
            glClear(GL_COLOR_BUFFER_BIT);
            ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

            glfwSwapBuffers(window);
        }
    }

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImPlot::DestroyContext();
    ImGui::DestroyContext();

    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
