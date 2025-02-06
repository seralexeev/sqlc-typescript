const PLATFORM_MAP: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
};

const ARCH_MAP: Partial<Record<NodeJS.Architecture, string>> = {
    x64: 'amd64',
    arm64: 'arm64',
};

const platform = PLATFORM_MAP[process.platform];
const arch = ARCH_MAP[process.arch];

if (!platform || !arch) {
    throw new Error(`Unsupported platform or architecture ${process.platform} ${process.arch}`);
}

export const BINARY_NAME = `sqlc_1.27.0_${platform}_${arch}${process.platform === 'win32' ? '.exe' : ''}`;
