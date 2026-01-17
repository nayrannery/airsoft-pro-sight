import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export default function HomeScreen() {
  const [facing, setFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0);
  const [stabilityScore, setStabilityScore] = useState(1);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const webViewRef = useRef<WebView>(null);

  // Ocultar barra de status para tela cheia imersiva
  useEffect(() => {
    StatusBar.setHidden(true);
    return () => StatusBar.setHidden(false);
  }, []);

  // Sistema de estabilidade baseado em TREMOR (variação), não posição absoluta
  useEffect(() => {
    let lastRotation = { alpha: 0, beta: 0, gamma: 0 };
    let stabilityHistory: number[] = [];
    let updateCount = 0;

    DeviceMotion.setUpdateInterval(100); // 10 leituras por segundo

    const subscription = DeviceMotion.addListener((data) => {
      updateCount++;
      
      if (updateCount % 10 === 0) {
        console.log(`📡 DeviceMotion ativo - Update #${updateCount}`, data.rotation);
      }
      
      if (data.rotation) {
        const { alpha, beta, gamma } = data.rotation;
        
        // Calcula VARIAÇÃO (tremor) entre leituras
        const deltaAlpha = Math.abs((alpha || 0) - lastRotation.alpha);
        const deltaBeta = Math.abs((beta || 0) - lastRotation.beta);
        const deltaGamma = Math.abs((gamma || 0) - lastRotation.gamma);
        
        const tremor = deltaAlpha + deltaBeta + deltaGamma;
        
        // Atualiza última leitura
        lastRotation = { alpha: alpha || 0, beta: beta || 0, gamma: gamma || 0 };
        
        // Histórico para suavizar (média móvel)
        stabilityHistory.push(tremor);
        if (stabilityHistory.length > 5) {
          stabilityHistory.shift();
        }
        
        // Média do tremor
        const avgTremor = stabilityHistory.reduce((a, b) => a + b, 0) / stabilityHistory.length;
        
        // Converte tremor para score visível (0-50, menor é melhor)
        const displayScore = avgTremor * 500; // Amplifica para visualização
        let score = displayScore;
        
        setStabilityScore(score);
        
        // Envia para o WebView atualizar a UI
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`
            if (typeof window.updateStability === 'function') {
              window.updateStability(${score.toFixed(1)});
              true;
            }
          `);
        }
      }
    });

    return () => subscription && subscription.remove();
  }, []);

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Carregando câmera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Precisamos da sua permissão para usar a câmera</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Permitir Câmera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('📨 Mensagem recebida do WebView:', data);
      
      switch (data.type) {
        case 'zoom':
          // Converte 0-1 do slider para 0-1 da câmera
          const zoomValue = Math.max(0, Math.min(1, data.value));
          setZoom(zoomValue);
          console.log(`🔍 Zoom ajustado: ${(data.value * 10).toFixed(1)}x (normalizado: ${zoomValue.toFixed(2)})`);
          break;

        case 'saveProfile':
          try {
            // Valida se os dados estão completos
            if (!data.name) {
              console.log('⚠️ Salvamento cancelado - sem nome de perfil');
              break;
            }
            
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            const profiles = profilesJson ? JSON.parse(profilesJson) : [];
            // Os dados vêm direto no data (name, zoom, reticleType, reticleColor)
            const profile = {
              name: data.name,
              zoom: data.zoom || 0,
              reticleType: data.reticleType || 'cruz',
              reticleColor: data.reticleColor || '#0f0'
            };
            profiles.push(profile);
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(profiles));
            Alert.alert('✅ Sucesso', `Perfil "${profile.name}" salvo!`);
            console.log('✅ Perfil salvo:', profile);
          } catch (error) {
            Alert.alert('❌ Erro', 'Falha ao salvar perfil');
            console.error('Erro ao salvar perfil:', error);
          }
          break;

        case 'loadProfile':
        case 'loadProfiles':
          try {
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            const profiles = profilesJson ? JSON.parse(profilesJson) : [];
            webViewRef.current?.injectJavaScript(`
              if (window.receiveProfiles) {
                window.receiveProfiles(${JSON.stringify(profiles)});
              }
            `);
            console.log('📂 Perfis carregados:', profiles.length);
          } catch (error) {
            Alert.alert('❌ Erro', 'Falha ao carregar perfis');
            console.error('Erro ao carregar perfis:', error);
          }
          break;

        case 'deleteProfile':
          try {
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            let profiles = profilesJson ? JSON.parse(profilesJson) : [];
            profiles = profiles.filter((p: any) => p.id !== data.id);
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(profiles));
            console.log('🗑️ Perfil deletado:', data.id);
          } catch (error) {
            console.error('Erro ao deletar perfil:', error);
          }
          break;

        case 'saveAllProfiles':
          try {
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(data.profiles));
            console.log('💾 Todos os perfis salvos (total:', data.profiles.length, ')');
          } catch (error) {
            console.error('Erro ao salvar perfis:', error);
          }
          break;

        case 'takePhoto':
          console.log('📷 Captura de foto solicitada');
          break;

        case 'saveState':
          try {
            await AsyncStorage.setItem('airsoftState', JSON.stringify(data.state));
            console.log('💾 Estado auto-salvo');
          } catch (error) {
            console.error('Erro ao salvar estado:', error);
          }
          break;

        case 'loadState':
          try {
            const stateJson = await AsyncStorage.getItem('airsoftState');
            const state = stateJson ? JSON.parse(stateJson) : null;
            if (state && webViewRef.current) {
              webViewRef.current.injectJavaScript(`
                if (window.applyState) {
                  window.applyState(${JSON.stringify(state)});
                }
              `);
              console.log('📂 Estado restaurado');
            }
          } catch (error) {
            console.error('Erro ao carregar estado:', error);
          }
          break;

        case 'stateChanged':
          console.log('Estado atualizado:', data.state);
          break;

        case 'ready':
        case 'webview_ready':
          console.log('✅ WebView pronto:', data.message || 'Carregado');
          break;

        case 'dpad':
          console.log('🎮 D-Pad pressionado:', data.direction);
          break;

        case 'calibrate':
        case 'tare':
          console.log('🎯 Calibração/Tara solicitada');
          break;

        default:
          console.log('❓ Mensagem não reconhecida:', data);
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  };

  // Lê o arquivo HTML original completo
  const htmlSource = require('../index.html');

  return (
    <View style={styles.container}>
      {/* Câmera Nativa no fundo */}
      <CameraView 
        ref={cameraRef}
        style={styles.camera} 
        facing={facing}
        zoom={zoom}
      />
      
      {/* Wrapper para WebView com transparência forçada no Android */}
      <View 
        style={styles.webviewWrapper}
        collapsable={false}
        needsOffscreenAlphaCompositing={true}
      >
        {/* WebView com HTML transparente sobreposto */}
        <WebView
          ref={webViewRef}
          source={htmlSource}
          style={styles.webviewOverlay}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          scrollEnabled={false}
          bounces={false}
          onMessage={handleWebViewMessage}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          // Propriedades para transparência no Android
          androidLayerType="hardware"
          // Injeta CSS adicional para garantir transparência
          injectedJavaScript={`
            document.body.style.background = 'transparent';
            document.documentElement.style.background = 'transparent';
            true;
          `}
          onLoad={async () => {
            // Auto-load do último estado salvo
            try {
              const stateJson = await AsyncStorage.getItem('airsoftState');
              const state = stateJson ? JSON.parse(stateJson) : null;
              if (state) {
                setTimeout(() => {
                  webViewRef.current?.injectJavaScript(`
                    if (window.applyState) {
                      window.applyState(${JSON.stringify(state)});
                    }
                  `);
                  console.log('🚀 Estado inicial restaurado');
                }, 500); // Aguarda 500ms para garantir que o HTML carregou
              }
            } catch (e) {
              console.error('❌ Erro ao carregar estado inicial:', e);
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  webviewWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  webviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: 18,
    color: '#0f0',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#0f0',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#0f0',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    marginHorizontal: 20,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },
});
