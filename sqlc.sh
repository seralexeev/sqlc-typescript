#!/bin/bash

# Version of SQLC to download
VERSION="1.27.0"

# Create directory if it doesn't exist
mkdir -p bin/sqlc

# Base URL for downloads
BASE_URL="https://downloads.sqlc.dev"

# Function to download and extract
download_and_extract() {
    local platform=$1
    local arch=$2
    local zip_file="sqlc_${VERSION}_${platform}_${arch}.zip"
    local target_name="sqlc_${platform}_${arch}"
    local source_file="sqlc"

    if [ "$platform" = "windows" ]; then
        target_name="${target_name}.exe"
        source_file="sqlc.exe"
    fi

    echo "Downloading ${zip_file}..."

    # Download the zip file
    if ! curl -L "${BASE_URL}/${zip_file}" -o "${zip_file}"; then
        echo "Failed to download ${zip_file}"
        return 1
    fi

    # Extract the file and rename it
    if ! unzip -j "${zip_file}" "${source_file}" -d bin/sqlc/; then
        echo "Failed to extract ${zip_file}"
        rm "${zip_file}"
        return 1
    fi

    # Rename the extracted file
    mv "bin/sqlc/${source_file}" "bin/sqlc/${target_name}"

    # Clean up zip file
    rm "${zip_file}"

    echo "Successfully processed ${zip_file}"
}

# Download and extract all versions
download_and_extract "darwin" "amd64"
download_and_extract "darwin" "arm64"
download_and_extract "linux" "amd64"
download_and_extract "linux" "arm64"
download_and_extract "windows" "amd64"

echo "All downloads completed!"
