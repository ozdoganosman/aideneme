cmake_minimum_required(VERSION 3.16)
project(borsa LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# ---- Dependencies ------------------------------------------------------------
# Linux/macOS pull GLFW + libcurl from the system; Windows builds GLFW from
# source and uses the OS WinHTTP + opengl32, so no external dev packages are
# needed there (great for a self-contained .exe, incl. MinGW cross-compiles).
#   Linux: apt install libglfw3-dev libgl1-mesa-dev libcurl4-openssl-dev xorg-dev
#   macOS: brew install glfw curl
find_package(Threads REQUIRED)

if(NOT WIN32)
    find_package(OpenGL REQUIRED)
    find_package(glfw3 REQUIRED)
    find_package(CURL REQUIRED)
endif()

# ---- Fetched dependencies (Dear ImGui, ImPlot, nlohmann/json) -----------------
include(FetchContent)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_Declare(json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE)

# ImGui and ImPlot ship no CMakeLists, so we only populate the sources and add
# the .cpp files to our target below.
FetchContent_Declare(imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG        v1.90.9
    GIT_SHALLOW    TRUE)
FetchContent_Declare(implot
    GIT_REPOSITORY https://github.com/epezent/implot.git
    GIT_TAG        v0.16
    GIT_SHALLOW    TRUE)

FetchContent_MakeAvailable(json)
FetchContent_MakeAvailable(imgui)
FetchContent_MakeAvailable(implot)

# On Windows, build GLFW from source (static) so users need no dev packages.
if(WIN32)
    set(GLFW_BUILD_EXAMPLES OFF CACHE INTERNAL "")
    set(GLFW_BUILD_TESTS    OFF CACHE INTERNAL "")
    set(GLFW_BUILD_DOCS     OFF CACHE INTERNAL "")
    FetchContent_Declare(glfw
        GIT_REPOSITORY https://github.com/glfw/glfw.git
        GIT_TAG        3.4
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(glfw)
endif()

# ---- Executable ---------------------------------------------------------------
add_executable(borsa
    src/main.cpp
    src/App.cpp
    src/chart/ChartView.cpp
    src/net/Http.cpp
    src/data/SyntheticProvider.cpp
    src/data/BinanceProvider.cpp

    # Dear ImGui core + GLFW/OpenGL3 backends
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp

    # ImPlot
    ${implot_SOURCE_DIR}/implot.cpp
    ${implot_SOURCE_DIR}/implot_items.cpp
)

target_include_directories(borsa PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${imgui_SOURCE_DIR}
    ${imgui_SOURCE_DIR}/backends
    ${implot_SOURCE_DIR}
)

target_link_libraries(borsa PRIVATE
    nlohmann_json::nlohmann_json
    Threads::Threads
    ${CMAKE_DL_LIBS}
)

if(WIN32)
    # GLFW (static) + system OpenGL + WinHTTP
    target_link_libraries(borsa PRIVATE glfw opengl32 winhttp)
else()
    target_link_libraries(borsa PRIVATE glfw OpenGL::GL CURL::libcurl)
endif()

if(MSVC)
    target_compile_options(borsa PRIVATE /O2)
else()
    target_compile_options(borsa PRIVATE -O2 -Wall)
endif()
