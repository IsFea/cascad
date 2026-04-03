FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src

COPY Cascad.sln ./Cascad.sln
COPY Cascad.Api/Cascad.Api.csproj ./Cascad.Api/Cascad.Api.csproj
RUN dotnet restore ./Cascad.Api/Cascad.Api.csproj

COPY Cascad.Api ./Cascad.Api
RUN dotnet publish ./Cascad.Api/Cascad.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS final
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Cascad.Api.dll"]
